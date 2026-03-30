import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();
const scriptPath = resolve(repoRoot, 'scripts', 'install-summary.mjs');
const tsxLoader = resolve(repoRoot, 'node_modules', 'tsx', 'dist', 'loader.mjs');
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => import('node:fs/promises').then((fs) => fs.rm(dir, { recursive: true, force: true }))));
  tempDirs.length = 0;
});

describe('install summary script', () => {
  it('summarizes actions, statuses, notes, errors, and recent events', async () => {
    const workdir = await mkdtemp(resolve(tmpdir(), 'a-plus-install-summary-'));
    tempDirs.push(workdir);

    const dataDir = resolve(workdir, 'data');
    await mkdir(dataDir, { recursive: true });
    const logPath = resolve(dataDir, 'install-events.jsonl');
    const now = new Date().toISOString();

    const fixture = [
      JSON.stringify({ ts: now, slug: 'demo/one', action: 'auto-install', status: 'installed', degraded: false, notes: [] }),
      JSON.stringify({ ts: now, slug: 'demo/two', action: 'confirm-install', status: 'skipped', degraded: false, notes: ['hold override pending: confirmation missing'] }),
      JSON.stringify({ ts: now, slug: 'demo/three', action: 'auto-install', status: 'failed', degraded: false, errorCode: 'INSTALL_TIMEOUT', notes: ['timeout after 1000ms'] })
    ].join('\n');

    await writeFile(logPath, `${fixture}\n`, 'utf8');

    const { stdout } = await execFileAsync('node', ['--import', tsxLoader, scriptPath, '--hours', '24'], {
      cwd: workdir
    });

    expect(stdout).toContain('install_summary hours=24');
    expect(stdout).toContain('by action');
    expect(stdout).toContain('- auto-install: 2');
    expect(stdout).toContain('- confirm-install: 1');
    expect(stdout).toContain('by status');
    expect(stdout).toContain('- installed: 1');
    expect(stdout).toContain('- skipped: 1');
    expect(stdout).toContain('- failed: 1');
    expect(stdout).toContain('top notes');
    expect(stdout).toContain('- hold override pending: confirmation missing: 1');
    expect(stdout).toContain('by error');
    expect(stdout).toContain('- INSTALL_TIMEOUT: 1');
    expect(stdout).toContain('recent events');
    expect(stdout).toContain('slug=demo/three');
  });

  it('returns empty summary when audit log is missing', async () => {
    const workdir = await mkdtemp(resolve(tmpdir(), 'a-plus-install-summary-empty-'));
    tempDirs.push(workdir);

    const { stdout } = await execFileAsync('node', ['--import', tsxLoader, scriptPath], {
      cwd: workdir
    });

    expect(stdout).toContain('records=0');
    expect(stdout).toContain('recent events');
    expect(stdout).toContain('- none');
  });
});
