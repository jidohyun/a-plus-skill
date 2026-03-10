import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { spawn, spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDefaultRunner,
  parseInstallCommandTimeoutMs,
  runInstall
} from '../src/install/openclawInstaller.js';
import {
  getInstallAuditAnchorPath,
  getInstallAuditBootstrapFusePath,
  getInstallAuditBootstrapLatchPath,
  getInstallAuditBootstrapMarkerPath
} from '../src/install/auditIntegrity.js';
import {
  appendInstallOpsEvent,
  consumeFastAuditFailInstallCap,
  parseInstallTimeoutRecoveryDelayMs,
  shouldRecoverAfterInstallTimeout,
  waitForInstallTimeoutRecovery
} from '../src/index.js';
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

type FakeChild = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  pid: number;
  kill: (signal?: NodeJS.Signals) => boolean;
};

function createFakeChild(pid = 4321): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.pid = pid;
  child.kill = vi.fn(() => true);
  return child;
}

function runAuditVerify(logPath: string): ReturnType<typeof spawnSync> {
  return spawnSync('node', ['--import', 'tsx', 'scripts/install-audit-verify.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      INSTALL_AUDIT_LOG_PATH: logPath
    },
    encoding: 'utf8'
  });
}

function runAuditWriterProcess(logPath: string, slug: string): Promise<{ code: number | null; stderr: string }> {
  const childScript = `
import { runInstall } from './src/install/openclawInstaller.ts';
import { planInstallAction } from './src/policy/policyEngine.ts';
const plan = planInstallAction('balanced', 'recommend', {});
await runInstall(${JSON.stringify(slug)}, plan, async () => ({ code: 0, stdout: 'ok', stderr: '' }));
`;

  return new Promise((resolve) => {
    const child = spawn('node', ['--input-type=module', '--import', 'tsx', '-e', childScript], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        INSTALL_AUDIT_LOG_PATH: logPath,
        INSTALL_OVERRIDE_SIGNING_SECRET: TEST_SIGNING_SECRET
      },
      stdio: ['ignore', 'ignore', 'pipe']
    });

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    child.on('close', (code) => {
      resolve({ code, stderr });
    });
  });
}

function runFastCapConsumerProcess(statePath: string, keyPath: string, cap: number): Promise<{ code: number | null; stderr: string }> {
  const childScript = `
import { consumeFastAuditFailInstallCap } from './src/index.ts';
import { planInstallAction } from './src/policy/policyEngine.ts';
const plan = planInstallAction('fast', 'recommend', {});
consumeFastAuditFailInstallCap('fast', plan, { ok: false, line: 1, reason: 'hash mismatch', verifiedCount: 0, lastHash: 'genesis' }, ${cap}, ${JSON.stringify(statePath)}, ${JSON.stringify(keyPath)});
`;

  return new Promise((resolve) => {
    const child = spawn('node', ['--input-type=module', '--import', 'tsx', '-e', childScript], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        INSTALL_OVERRIDE_SIGNING_SECRET: TEST_SIGNING_SECRET
      },
      stdio: ['ignore', 'ignore', 'pipe']
    });

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    child.on('close', (code) => {
      resolve({ code, stderr });
    });
  });
}

beforeEach(() => {
  __resetOverrideNonceCacheForTests();
  process.env.INSTALL_OVERRIDE_SIGNING_SECRET = TEST_SIGNING_SECRET;
});

afterEach(() => {
  __resetOverrideNonceCacheForTests();
  delete process.env.INSTALL_OVERRIDE_SIGNING_SECRET;
  delete process.env.INSTALL_COMMAND_TIMEOUT_MS;
  delete process.env.INSTALL_TIMEOUT_RECOVERY_DELAY_MS;
  delete process.env.INSTALL_AUDIT_LOG_PATH;
  delete process.env.FAST_AUDIT_FAIL_MAX_INSTALLS;
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

  it('uses tree-aware process group kill on timeout (POSIX path)', async () => {
    vi.useFakeTimers();
    const child = createFakeChild(7001);
    const spawnImpl = vi.fn(() => child);
    const processKill = vi.fn(() => true);

    process.env.INSTALL_COMMAND_TIMEOUT_MS = '5';
    const runner = createDefaultRunner({ spawnImpl, processKill, topology: 'single-instance' });

    const pending = runner('demo/skill');
    await vi.advanceTimersByTimeAsync(5);
    await vi.advanceTimersByTimeAsync(2100);
    await vi.runOnlyPendingTimersAsync();

    expect(processKill).toHaveBeenCalledWith(-7001, 'SIGTERM');
    expect(processKill).toHaveBeenCalledWith(-7001, 'SIGKILL');
    expect((child.kill as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);

    child.emit('close', null, 'SIGKILL');
    const result = await pending;
    expect(result.error).toBe('timeout');

    vi.useRealTimers();
  });

  it('falls back to child.kill when process group kill fails', async () => {
    vi.useFakeTimers();
    const child = createFakeChild(7002);
    const spawnImpl = vi.fn(() => child);
    const processKill = vi.fn(() => {
      throw new Error('not permitted');
    });

    process.env.INSTALL_COMMAND_TIMEOUT_MS = '5';
    const runner = createDefaultRunner({ spawnImpl, processKill, topology: 'single-instance' });

    const pending = runner('demo/skill');
    await vi.advanceTimersByTimeAsync(5);
    await vi.advanceTimersByTimeAsync(2100);
    await vi.runOnlyPendingTimersAsync();

    expect(processKill).toHaveBeenCalledWith(-7002, 'SIGTERM');
    expect(processKill).toHaveBeenCalledWith(-7002, 'SIGKILL');
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');

    child.emit('close', null, 'SIGKILL');
    const result = await pending;
    expect(result.error).toBe('timeout');

    vi.useRealTimers();
  });

  it('applies topology-aware timeout cap and invalid fallback', () => {
    expect(parseInstallCommandTimeoutMs('999999', 'local-dev')).toBe(300000);
    expect(parseInstallCommandTimeoutMs('999999', 'single-instance')).toBe(120000);
    expect(parseInstallCommandTimeoutMs('999999', 'multi-instance')).toBe(90000);
    expect(parseInstallCommandTimeoutMs('not-a-number', 'multi-instance')).toBe(60000);
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

  it('applies timeout recovery delay and keeps batch continuity', async () => {
    process.env.INSTALL_TIMEOUT_RECOVERY_DELAY_MS = '250';
    const sleep = vi.fn(async () => {});
    const plan = planInstallAction('balanced', 'recommend', {});

    const first = await runInstall('demo/slow', plan, async () => ({
      code: null,
      signal: 'SIGKILL',
      stdout: '',
      stderr: 'timeout exceeded',
      error: 'timeout',
      elapsedMs: 3000,
      timeoutMs: 1000
    }));

    const delayApplied = await waitForInstallTimeoutRecovery(first, sleep);

    const second = await runInstall('demo/ok', plan, async () => ({
      code: 0,
      stdout: 'installed',
      stderr: ''
    }));

    expect(shouldRecoverAfterInstallTimeout(first)).toBe(true);
    expect(delayApplied).toBe(250);
    expect(sleep).toHaveBeenCalledWith(250);
    expect(second.status).toBe('installed');
  });

  it('clamps recovery delay env to safe range', () => {
    expect(parseInstallTimeoutRecoveryDelayMs('999999')).toBe(2000);
    expect(parseInstallTimeoutRecoveryDelayMs('-1')).toBe(250);
    expect(parseInstallTimeoutRecoveryDelayMs('0')).toBe(0);
  });

  it('applies fast audit-failure install cap with persisted state across reruns', () => {
    process.env.FAST_AUDIT_FAIL_MAX_INSTALLS = '2';
    const failedIntegrity = {
      ok: false,
      line: 9,
      reason: 'hash mismatch',
      verifiedCount: 0,
      lastHash: 'genesis'
    } as const;

    const dir = mkdtempSync(join(tmpdir(), 'fast-cap-state-'));
    const statePath = join(dir, 'fast-audit-fail-cap.json');
    const base = planInstallAction('fast', 'recommend', {});

    const first = consumeFastAuditFailInstallCap('fast', base, failedIntegrity, 2, statePath);
    const second = consumeFastAuditFailInstallCap('fast', base, failedIntegrity, 2, statePath);
    const third = consumeFastAuditFailInstallCap('fast', base, failedIntegrity, 2, statePath);

    expect(first.plan.canInstall).toBe(true);
    expect(second.plan.canInstall).toBe(true);
    expect(third.plan.canInstall).toBe(false);
    expect(third.plan.action).toBe('skip-install');
    expect(third.plan.notes.join(' ')).toContain('fast install cap exceeded (3/2)');
  });

  it('demotes on fast-cap checksum tamper (no fail-open)', () => {
    const failedIntegrity = {
      ok: false,
      line: 12,
      reason: 'hash mismatch',
      verifiedCount: 0,
      lastHash: 'genesis'
    } as const;
    const dir = mkdtempSync(join(tmpdir(), 'fast-cap-tamper-'));
    const statePath = join(dir, 'fast-audit-fail-cap.json');
    const keyPath = join(dir, 'fast-audit-fail-cap.key');
    const base = planInstallAction('fast', 'recommend', {});

    consumeFastAuditFailInstallCap('fast', base, failedIntegrity, 5, statePath, keyPath);

    const tampered = JSON.parse(readFileSync(statePath, 'utf8')) as Record<string, unknown>;
    tampered.count = 0;
    writeFileSync(statePath, `${JSON.stringify(tampered, null, 2)}\n`, 'utf8');

    const second = consumeFastAuditFailInstallCap('fast', base, failedIntegrity, 5, statePath, keyPath);
    expect(second.demotedByCap).toBe(true);
    expect(second.count).toBe(6);
  });

  it('demotes on suspicious reset when key exists but state file is deleted', () => {
    const failedIntegrity = {
      ok: false,
      line: 13,
      reason: 'hash mismatch',
      verifiedCount: 0,
      lastHash: 'genesis'
    } as const;
    const dir = mkdtempSync(join(tmpdir(), 'fast-cap-reset-'));
    const statePath = join(dir, 'fast-audit-fail-cap.json');
    const keyPath = join(dir, 'fast-audit-fail-cap.key');
    const base = planInstallAction('fast', 'recommend', {});

    consumeFastAuditFailInstallCap('fast', base, failedIntegrity, 4, statePath, keyPath);
    rmSync(statePath, { force: true });

    const second = consumeFastAuditFailInstallCap('fast', base, failedIntegrity, 4, statePath, keyPath);
    expect(second.demotedByCap).toBe(true);
    expect(second.count).toBe(5);
  });

  it('keeps fast-cap counter consistent across concurrent multi-process updates', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fast-cap-concurrent-'));
    const statePath = join(dir, 'fast-audit-fail-cap.json');
    const keyPath = join(dir, 'fast-audit-fail-cap.key');

    const writes = await Promise.all(Array.from({ length: 8 }, () => runFastCapConsumerProcess(statePath, keyPath, 50)));
    for (const write of writes) {
      expect(write.code).toBe(0);
      expect(write.stderr).toBe('');
    }

    const state = JSON.parse(readFileSync(statePath, 'utf8')) as Record<string, unknown>;
    expect(state.count).toBe(8);
    expect(state.schemaVersion).toBe(1);
    expect(typeof state.updatedAt).toBe('string');
    expect(typeof state.checksum).toBe('string');
  });

  it('records ops-event when fast audit-failure cap demotes install', () => {
    const failedIntegrity = {
      ok: false,
      line: 11,
      reason: 'hash mismatch',
      verifiedCount: 0,
      lastHash: 'genesis'
    } as const;
    const dir = mkdtempSync(join(tmpdir(), 'fast-cap-ops-'));
    const statePath = join(dir, 'fast-audit-fail-cap.json');
    const opsPath = join(dir, 'install-ops-events.jsonl');
    const base = planInstallAction('fast', 'recommend', {});

    consumeFastAuditFailInstallCap('fast', base, failedIntegrity, 1, statePath);
    const second = consumeFastAuditFailInstallCap('fast', base, failedIntegrity, 1, statePath);
    expect(second.demotedByCap).toBe(true);

    const append = appendInstallOpsEvent(
      {
        policy: 'fast',
        reason: 'fast audit failure cap exceeded',
        line: failedIntegrity.line,
        action: 'demote',
        auditPath: '/tmp/install-events.jsonl',
        notes: [`count=${second.count}`, `cap=${second.cap}`, 'slug=demo/skill']
      },
      opsPath
    );

    expect(append.ok).toBe(true);
    const event = JSON.parse(readFileSync(opsPath, 'utf8').trim()) as Record<string, unknown>;
    expect(event.policy).toBe('fast');
    expect(event.action).toBe('demote');
    expect(event.notes).toEqual([`count=${second.count}`, 'cap=1', 'slug=demo/skill']);
  });

  it('writes audit event for canInstall=false path', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'install-audit-'));
    const logPath = join(dir, 'events.jsonl');
    process.env.INSTALL_AUDIT_LOG_PATH = logPath;

    const plan = planInstallAction('balanced', 'hold', { confirmed: false });
    const outcome = await runInstall('demo/skill', plan);

    expect(outcome.status).toBe('skipped');

    const lines = readFileSync(logPath, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
    const event = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;

    expect(event.action).toBe('confirm-install');
    expect(event.canInstall).toBe(false);
    expect(event.status).toBe('skipped');
    expect(event.errorCode).toBeUndefined();
  });

  it('creates audit anchor + bootstrapped marker + bootstrap fuse files after successful audit append', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'install-audit-'));
    const logPath = join(dir, 'events.jsonl');
    process.env.INSTALL_AUDIT_LOG_PATH = logPath;

    const plan = planInstallAction('balanced', 'recommend', {});
    const outcome = await runInstall('demo/skill', plan, async () => ({ code: 0, stdout: 'ok', stderr: '' }));

    expect(outcome.status).toBe('installed');

    const anchorPath = getInstallAuditAnchorPath(logPath);
    expect(existsSync(anchorPath)).toBe(true);

    const anchor = JSON.parse(readFileSync(anchorPath, 'utf8')) as Record<string, unknown>;
    expect(typeof anchor.createdAt).toBe('string');
    expect(anchor.schemaVersion).toBe(1);

    const markerPath = getInstallAuditBootstrapMarkerPath(logPath);
    expect(existsSync(markerPath)).toBe(true);

    const marker = JSON.parse(readFileSync(markerPath, 'utf8')) as Record<string, unknown>;
    expect(typeof marker.createdAt).toBe('string');
    expect(marker.schemaVersion).toBe(1);

    const fusePath = getInstallAuditBootstrapFusePath(logPath);
    expect(existsSync(fusePath)).toBe(true);

    const fuse = JSON.parse(readFileSync(fusePath, 'utf8')) as Record<string, unknown>;
    expect(typeof fuse.createdAt).toBe('string');
    expect(fuse.schemaVersion).toBe(1);

    const latchPath = getInstallAuditBootstrapLatchPath(logPath);
    expect(existsSync(latchPath)).toBe(true);

    const latch = JSON.parse(readFileSync(latchPath, 'utf8')) as Record<string, unknown>;
    expect(typeof latch.createdAt).toBe('string');
    expect(latch.schemaVersion).toBe(1);
  });

  it('warns and avoids fail-open append when anchor create fails with non-EEXIST error', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'install-audit-'));
    const logPath = join(dir, 'events.jsonl');
    process.env.INSTALL_AUDIT_LOG_PATH = logPath;

    vi.resetModules();
    vi.doMock('node:fs', async () => {
      const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
      return {
        ...actual,
        writeFileSync: vi.fn((path: Parameters<typeof actual.writeFileSync>[0], data: Parameters<typeof actual.writeFileSync>[1], options?: Parameters<typeof actual.writeFileSync>[2]) => {
          if (String(path).endsWith('.anchor')) {
            const error = new Error('mock anchor write failure') as Error & { code?: string };
            error.code = 'EACCES';
            throw error;
          }
          return actual.writeFileSync(path, data, options as never);
        })
      };
    });

    const { runInstall: mockedRunInstall } = await import('../src/install/openclawInstaller.js');

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const plan = planInstallAction('balanced', 'recommend', {});
    const outcome = await mockedRunInstall('demo/anchor-fail', plan, async () => ({ code: 0, stdout: 'ok', stderr: '' }));

    expect(outcome.status).toBe('installed');
    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls.some((args) => String(args[0] ?? '').includes('mock anchor write failure'))).toBe(true);
    expect(existsSync(logPath)).toBe(false);

    warn.mockRestore();
    vi.doUnmock('node:fs');
    vi.resetModules();
  });

  it('writes success/failure/timeout audit fields', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'install-audit-'));
    const logPath = join(dir, 'events.jsonl');
    process.env.INSTALL_AUDIT_LOG_PATH = logPath;

    const plan = planInstallAction('balanced', 'recommend', {});

    await runInstall('demo/success', plan, async () => ({ code: 0, stdout: 'ok', stderr: '', elapsedMs: 120, timeoutMs: 1000 }));
    await runInstall('demo/failure', plan, async () => ({ code: 1, stdout: '', stderr: 'fail', elapsedMs: 90, timeoutMs: 1000 }));
    await runInstall('demo/timeout', plan, async () => ({
      code: null,
      signal: 'SIGKILL',
      stdout: '',
      stderr: 'timeout exceeded',
      error: 'timeout',
      elapsedMs: 1500,
      timeoutMs: 1000
    }));

    const events = readFileSync(logPath, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);

    expect(events[0]?.status).toBe('installed');
    expect(events[0]?.errorCode).toBeUndefined();
    expect(events[1]?.status).toBe('failed');
    expect(events[1]?.errorCode).toBe('INSTALL_COMMAND_FAILED');
    expect(events[2]?.status).toBe('failed');
    expect(events[2]?.errorCode).toBe('INSTALL_TIMEOUT');
    expect(events[2]?.elapsedMs).toBe(1500);
    expect(events[2]?.timeoutMs).toBe(1000);
  });

  it('keeps INSTALL_RUNTIME_ERROR for failed runtime error path', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'install-audit-'));
    const logPath = join(dir, 'events.jsonl');
    process.env.INSTALL_AUDIT_LOG_PATH = logPath;

    const plan = planInstallAction('balanced', 'recommend', {});
    await runInstall('demo/runtime-error', plan, async () => ({
      code: null,
      stdout: '',
      stderr: 'spawn EACCES',
      error: 'spawn EACCES',
      elapsedMs: 42,
      timeoutMs: 1000
    }));

    const event = JSON.parse(readFileSync(logPath, 'utf8').trim()) as Record<string, unknown>;
    expect(event.status).toBe('failed');
    expect(event.errorCode).toBe('INSTALL_RUNTIME_ERROR');
  });

  it('records degraded hold in audit event', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'install-audit-'));
    const logPath = join(dir, 'events.jsonl');
    process.env.INSTALL_AUDIT_LOG_PATH = logPath;

    const plan = planInstallAction('fast', 'recommend', {
      degraded: true,
      confirmed: true,
      overrideToken: 'ok'
    });

    await runInstall('demo/skill', plan, undefined, { degraded: true, topology: 'single-instance' });

    const event = JSON.parse(readFileSync(logPath, 'utf8').trim()) as Record<string, unknown>;
    expect(event.degraded).toBe(true);
    expect(event.effectiveDecision).toBe('hold');
    expect(event.status).toBe('skipped');
  });

  it('masks override token from audit notes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'install-audit-'));
    const logPath = join(dir, 'events.jsonl');
    process.env.INSTALL_AUDIT_LOG_PATH = logPath;

    const token = makeCurrentOverrideToken();
    const plan = {
      ...planInstallAction('balanced', 'recommend', {}),
      notes: [`override token seen: ${token}`]
    };

    await runInstall('demo/skill', plan, async () => ({ code: 0, stdout: 'ok', stderr: '' }));

    const raw = readFileSync(logPath, 'utf8');
    expect(raw).not.toContain(token);
    expect(raw).toContain('[REDACTED_OVERRIDE_TOKEN]');
  });

  it('verifies valid audit hash chain', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'install-audit-'));
    const logPath = join(dir, 'events.jsonl');
    process.env.INSTALL_AUDIT_LOG_PATH = logPath;

    const plan = planInstallAction('balanced', 'recommend', {});
    await runInstall('demo/a', plan, async () => ({ code: 0, stdout: 'ok', stderr: '' }));
    await runInstall('demo/b', plan, async () => ({ code: 0, stdout: 'ok', stderr: '' }));

    const result = runAuditVerify(logPath);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('OK verified=2');
  });

  it('fails audit verify on tampered line', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'install-audit-'));
    const logPath = join(dir, 'events.jsonl');
    process.env.INSTALL_AUDIT_LOG_PATH = logPath;

    const plan = planInstallAction('balanced', 'recommend', {});
    await runInstall('demo/tampered', plan, async () => ({ code: 0, stdout: 'ok', stderr: '' }));

    const lines = readFileSync(logPath, 'utf8').trim().split('\n');
    const event = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
    event.status = 'failed';
    lines[0] = JSON.stringify(event);
    writeFileSync(logPath, `${lines.join('\n')}\n`, 'utf8');

    const result = runAuditVerify(logPath);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('hash mismatch');
  });

  it('fails audit verify on deleted line chain break', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'install-audit-'));
    const logPath = join(dir, 'events.jsonl');
    process.env.INSTALL_AUDIT_LOG_PATH = logPath;

    const plan = planInstallAction('balanced', 'recommend', {});
    await runInstall('demo/first', plan, async () => ({ code: 0, stdout: 'ok', stderr: '' }));
    await runInstall('demo/second', plan, async () => ({ code: 0, stdout: 'ok', stderr: '' }));

    const lines = readFileSync(logPath, 'utf8').trim().split('\n');
    writeFileSync(logPath, `${lines.slice(1).join('\n')}\n`, 'utf8');

    const result = runAuditVerify(logPath);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('prevHash mismatch');
  });

  it('fails audit verify on malformed JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'install-audit-'));
    const logPath = join(dir, 'events.jsonl');
    writeFileSync(logPath, '{"broken":true\n', 'utf8');

    const result = runAuditVerify(logPath);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('malformed JSON');
  });

  it('fails audit verify on schemaVersion mismatch', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'install-audit-'));
    const logPath = join(dir, 'events.jsonl');
    process.env.INSTALL_AUDIT_LOG_PATH = logPath;

    const plan = planInstallAction('balanced', 'recommend', {});
    await runInstall('demo/schema', plan, async () => ({ code: 0, stdout: 'ok', stderr: '' }));

    const lines = readFileSync(logPath, 'utf8').trim().split('\n');
    const event = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
    event.schemaVersion = 2;
    lines[0] = JSON.stringify(event);
    writeFileSync(logPath, `${lines.join('\n')}\n`, 'utf8');

    const result = runAuditVerify(logPath);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('schemaVersion mismatch (expected=1, actual=2)');
  });

  it('keeps hash chain valid for parallel multi-process audit writes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'install-audit-'));
    const logPath = join(dir, 'events.jsonl');

    const writes = await Promise.all(
      Array.from({ length: 8 }, (_, i) => runAuditWriterProcess(logPath, `demo/parallel-${i}`))
    );

    for (const write of writes) {
      expect(write.code).toBe(0);
      expect(write.stderr).toBe('');
    }

    const lines = readFileSync(logPath, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(8);

    const result = runAuditVerify(logPath);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('OK verified=8');
  });

  it('recovers from stale audit lock and writes event', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'install-audit-'));
    const logPath = join(dir, 'events.jsonl');
    const lockPath = `${logPath}.lock`;
    process.env.INSTALL_AUDIT_LOG_PATH = logPath;

    writeFileSync(lockPath, JSON.stringify({ pid: 999999, createdAt: new Date(Date.now() - 5 * 60_000).toISOString() }), 'utf8');
    const staleDate = new Date(Date.now() - 5 * 60_000);
    utimesSync(lockPath, staleDate, staleDate);

    const plan = planInstallAction('balanced', 'recommend', {});
    const outcome = await runInstall('demo/stale-lock', plan, async () => ({
      code: 0,
      stdout: 'installed',
      stderr: ''
    }));

    expect(outcome.status).toBe('installed');

    const lines = readFileSync(logPath, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);

    const result = runAuditVerify(logPath);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('OK verified=1');
  });

  it('keeps timeout/warn path for active audit lock', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'install-audit-'));
    const logPath = join(dir, 'events.jsonl');
    const lockPath = `${logPath}.lock`;
    process.env.INSTALL_AUDIT_LOG_PATH = logPath;

    writeFileSync(lockPath, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }), 'utf8');

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const plan = planInstallAction('balanced', 'recommend', {});
    const outcome = await runInstall('demo/active-lock', plan, async () => ({
      code: 0,
      stdout: 'installed',
      stderr: ''
    }));

    expect(outcome.status).toBe('installed');
    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls.some((args) => String(args[0] ?? '').includes('install audit lock timeout'))).toBe(true);
    warn.mockRestore();
  });

  it('continues install flow when audit log write fails', async () => {
    process.env.INSTALL_AUDIT_LOG_PATH = '/dev/full/install-events.jsonl';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const plan = planInstallAction('balanced', 'recommend', {});
    const outcome = await runInstall('demo/skill', plan, async () => ({
      code: 0,
      stdout: 'installed',
      stderr: ''
    }));

    expect(outcome.status).toBe('installed');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
