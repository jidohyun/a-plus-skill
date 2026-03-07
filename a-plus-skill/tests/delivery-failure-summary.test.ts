import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const scriptPath = resolve(process.cwd(), 'scripts/delivery-failure-summary.mjs');

const tempDirs: string[] = [];

describe('delivery failure summary script', () => {
  afterEach(async () => {
    while (tempDirs.length) {
      const dir = tempDirs.pop()!;
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('groups unsupported and lock mismatch as skip category', async () => {
    const workdir = await mkdtemp(resolve(tmpdir(), 'a-plus-summary-'));
    tempDirs.push(workdir);

    const dataDir = resolve(workdir, 'data');
    await mkdir(dataDir, { recursive: true });

    const logPath = resolve(dataDir, 'report-delivery.log');

    const now = new Date().toISOString();
    const fixture = [
      `${now} event=delivery_failed mode=discord-dm code=NETWORK_ERROR status=503`,
      `${now} event=unsupported_mode mode=smtp`,
      `${now} event=lock_mismatch expected=discord-dm actual=telegram`
    ].join('\n');

    await writeFile(logPath, `${fixture}\n`, 'utf8');

    const { stdout } = await execFileAsync('node', [scriptPath, '--hours', '1'], {
      cwd: workdir
    });

    expect(stdout).toContain('- records: 3');
    expect(stdout).toContain('- failures: 1');
    expect(stdout).toContain('- skips: 2');
    expect(stdout).toContain('by category');
    expect(stdout).toContain('- skip: 2');
    expect(stdout).toContain('- failure: 1');
  });
});
