import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDefaultRunner, runInstall } from '../src/install/openclawInstaller.js';
import { __resetOverrideNonceCacheForTests, planInstallAction } from '../src/policy/policyEngine.js';

const TEST_SIGNING_SECRET = 'test-signing-secret';

function makeCurrentOverrideToken(): string {
  const now = Math.floor(Date.now() / 1000);
  const nonce = 'AbCdEfGhIjKlMnOpQrStUvWX';
  const iat = now - 10;
  const exp = now + 120;
  const payload = `${iat}.${exp}.${nonce}`;
  const sig = createHmac('sha256', TEST_SIGNING_SECRET).update(payload).digest('base64url');
  return `ovr1.${iat}.${exp}.${nonce}.${sig}`;
}

beforeEach(() => {
  __resetOverrideNonceCacheForTests();
  process.env.INSTALL_OVERRIDE_SIGNING_SECRET = TEST_SIGNING_SECRET;
});

afterEach(() => {
  __resetOverrideNonceCacheForTests();
  delete process.env.INSTALL_OVERRIDE_SIGNING_SECRET;
  delete process.env.INSTALL_COMMAND_TIMEOUT_MS;
});

describe('install flow', () => {
  it('does not run installer when hold has no override', async () => {
    const plan = planInstallAction('balanced', 'hold', { confirmed: false });

    const outcome = await runInstall(
      'demo/skill',
      plan,
      async () => ({
        code: 0,
        stdout: 'installed',
        stderr: ''
      })
    );

    expect(outcome.attempted).toBe(false);
    expect(outcome.status).toBe('skipped');
  });

  it('runs installer and returns failed outcome on command error', async () => {
    const plan = planInstallAction('balanced', 'hold', {
      confirmed: true,
      overrideToken: makeCurrentOverrideToken(),
      overrideReason: 'manual approval'
    });

    const outcome = await runInstall(
      'demo/skill',
      plan,
      async () => ({
        code: 1,
        stdout: '',
        stderr: 'permission denied'
      })
    );

    expect(outcome.attempted).toBe(true);
    expect(outcome.installed).toBe(false);
    expect(outcome.status).toBe('failed');
    expect(outcome.stderr).toContain('permission denied');
  });

  it('returns standardized failed(timeout) outcome', async () => {
    const plan = planInstallAction('balanced', 'recommend', {});

    const outcome = await runInstall(
      'demo/skill',
      plan,
      async () => ({
        code: null,
        signal: 'SIGTERM',
        stdout: '',
        stderr: 'killed after timeout',
        error: 'timeout',
        elapsedMs: 1500,
        timeoutMs: 1000
      })
    );

    expect(outcome.attempted).toBe(true);
    expect(outcome.status).toBe('failed');
    expect(outcome.error).toBe('timeout');
    expect(outcome.signal).toBe('SIGTERM');
    expect(outcome.elapsedMs).toBe(1500);
    expect(outcome.timeoutMs).toBe(1000);
  });

  it('forces hold in degraded mode and hard-blocks install attempt', async () => {
    const plan = planInstallAction('fast', 'recommend', {
      degraded: true,
      confirmed: true,
      overrideToken: 'ok'
    });

    const outcome = await runInstall(
      'demo/skill',
      plan,
      async () => ({
        code: 0,
        stdout: 'installed',
        stderr: ''
      })
    );

    expect(plan.effectiveDecision).toBe('hold');
    expect(plan.canInstall).toBe(false);
    expect(outcome.attempted).toBe(false);
    expect(outcome.status).toBe('skipped');
  });

  it('fails fast on invalid slug format', async () => {
    const plan = planInstallAction('balanced', 'recommend', {});
    const outcome = await runInstall('bad-slug', plan);

    expect(outcome.attempted).toBe(false);
    expect(outcome.status).toBe('failed');
    expect(outcome.error).toContain('invalid slug format');
  });

  it('falls back to default timeout on invalid INSTALL_COMMAND_TIMEOUT_MS', async () => {
    process.env.INSTALL_COMMAND_TIMEOUT_MS = 'not-a-number';
    const runner = createDefaultRunner();

    const result = await runner('demo/skill');

    expect(result.timeoutMs).toBe(60000);
  });

  it('continues processing next skill even after one timeout failure', async () => {
    const plan = planInstallAction('balanced', 'recommend', {});
    const slugs = ['demo/slow-skill', 'demo/ok-skill'];

    const outcomes = [];
    for (const slug of slugs) {
      const outcome = await runInstall(slug, plan, async (targetSlug) => {
        if (targetSlug === 'demo/slow-skill') {
          return {
            code: null,
            signal: 'SIGKILL',
            stdout: '',
            stderr: 'timeout exceeded',
            error: 'timeout',
            elapsedMs: 3000,
            timeoutMs: 1000
          };
        }

        return {
          code: 0,
          stdout: 'installed',
          stderr: ''
        };
      });
      outcomes.push(outcome);
    }

    expect(outcomes).toHaveLength(2);
    expect(outcomes[0]?.status).toBe('failed');
    expect(outcomes[0]?.error).toBe('timeout');
    expect(outcomes[1]?.status).toBe('installed');
  });
});
