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
    expect(stdout).toContain('- successes: 0');
    expect(stdout).toContain('- unknown: 0');
    expect(stdout).toContain('by category');
    expect(stdout).toContain('- skip: 2');
    expect(stdout).toContain('- failure: 1');
  });

  it('counts delivery_success as success and unknown events separately', async () => {
    const workdir = await mkdtemp(resolve(tmpdir(), 'a-plus-summary-events-'));
    tempDirs.push(workdir);

    const dataDir = resolve(workdir, 'data');
    await mkdir(dataDir, { recursive: true });

    const logPath = resolve(dataDir, 'report-delivery.log');

    const now = new Date().toISOString();
    const fixture = [
      `${now} event=delivery_success mode=discord-dm status=200`,
      `${now} event=delivery_failed mode=discord-dm code=NETWORK_ERROR status=503`,
      `${now} event=weird_future_event mode=discord-dm`
    ].join('\n');

    await writeFile(logPath, `${fixture}\n`, 'utf8');

    const { stdout } = await execFileAsync('node', [scriptPath, '--hours', '1'], {
      cwd: workdir
    });

    expect(stdout).toContain('- records: 3');
    expect(stdout).toContain('- failures: 1');
    expect(stdout).toContain('- successes: 1');
    expect(stdout).toContain('- unknown: 1');
    expect(stdout).toContain('by category');
    expect(stdout).toContain('- success: 1');
    expect(stdout).toContain('- failure: 1');
    expect(stdout).toContain('- unknown: 1');
    expect(stdout).toContain('by event');
    expect(stdout).toContain('- delivery_success: 1');
    expect(stdout).toContain('- weird_future_event: 1');
  });

  it('groups delivery records by collector source and reason', async () => {
    const workdir = await mkdtemp(resolve(tmpdir(), 'a-plus-summary-collector-'));
    tempDirs.push(workdir);

    const dataDir = resolve(workdir, 'data');
    await mkdir(dataDir, { recursive: true });

    const logPath = resolve(dataDir, 'report-delivery.log');

    const now = new Date().toISOString();
    const fixture = [
      `${now} event=delivery_success mode=discord-dm collector_source=live collector_degraded=false collector_reason=NONE`,
      `${now} event=delivery_failed mode=discord-dm code=NETWORK_ERROR collector_source=fallback collector_degraded=true collector_reason=FETCH_ERROR_TIMEOUT`,
      `${now} event=delivery_failed mode=discord-dm code=NETWORK_ERROR collector_source=fallback collector_degraded=true collector_reason=EMPTY_HTML`
    ].join('\n');

    await writeFile(logPath, `${fixture}\n`, 'utf8');

    const { stdout } = await execFileAsync('node', [scriptPath, '--hours', '1'], {
      cwd: workdir
    });

    expect(stdout).toContain('by collector source');
    expect(stdout).toContain('- fallback: 2');
    expect(stdout).toContain('- live: 1');
    expect(stdout).toContain('by collector reason');
    expect(stdout).toContain('- FETCH_ERROR_TIMEOUT: 1');
    expect(stdout).toContain('- EMPTY_HTML: 1');
    expect(stdout).toContain('- NONE: 1');
  });
});
