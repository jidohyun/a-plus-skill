import { describe, expect, it } from 'vitest';
import { runInstall } from '../src/install/openclawInstaller.js';
import { planInstallAction } from '../src/policy/policyEngine.js';

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
      overrideToken: '12345678901234567890',
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
});
