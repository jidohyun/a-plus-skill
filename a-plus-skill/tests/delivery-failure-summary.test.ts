import { rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const logPath = resolve(process.cwd(), 'data/report-delivery.log');
const rotatedPath = `${logPath}.1`;

describe('delivery failure summary script', () => {
  afterEach(async () => {
    await rm(logPath, { force: true });
    await rm(rotatedPath, { force: true });
  });

  it('groups unsupported and lock mismatch as skip category', async () => {
    const now = new Date().toISOString();
    const fixture = [
      `${now} event=delivery_failed mode=discord-dm code=NETWORK_ERROR status=503`,
      `${now} event=unsupported_mode mode=smtp`,
      `${now} event=lock_mismatch expected=discord-dm actual=telegram`
    ].join('\n');

    await writeFile(logPath, `${fixture}\n`, 'utf8');

    const { stdout } = await execFileAsync('node', ['scripts/delivery-failure-summary.mjs', '--hours', '1'], {
      cwd: process.cwd()
    });

    expect(stdout).toContain('- records: 3');
    expect(stdout).toContain('- failures: 1');
    expect(stdout).toContain('- skips: 2');
    expect(stdout).toContain('by category');
    expect(stdout).toContain('- skip: 2');
    expect(stdout).toContain('- failure: 1');
  });
});
