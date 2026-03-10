import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { appendFileSync, closeSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadInstallTopologyFromEnv } from './confirm.js';
import {
  INSTALL_AUDIT_GENESIS_PREV_HASH,
  INSTALL_AUDIT_SCHEMA_VERSION,
  computeInstallAuditHash,
  getInstallAuditAnchorPath,
  getInstallAuditPath
} from './auditIntegrity.js';
import type { InstallAuditEvent, InstallOutcome, InstallPlan, InstallTopology } from '../types/index.js';

export type InstallRunnerResult = {
  code: number | null;
  signal?: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  error?: string;
  elapsedMs?: number;
  timeoutMs?: number;
};

export type InstallRunner = (slug: string) => Promise<InstallRunnerResult>;

export type RunInstallOptions = {
  topology?: InstallTopology;
  degraded?: boolean;
};

const ALLOWED_BASE_COMMANDS = new Set(['openclaw']);
const STRICT_SUBCOMMAND = ['skill', 'install'];
const SLUG_PATTERN = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/;
const DEFAULT_INSTALL_TIMEOUT_MS = 60_000;
const MIN_INSTALL_TIMEOUT_MS = 1_000;
const TOPOLOGY_TIMEOUT_CAP_MS: Record<InstallTopology, number> = {
  'local-dev': 300_000,
  'single-instance': 120_000,
  'multi-instance': 90_000
};
const TERM_GRACE_MS = 2_000;

function validateSlug(slug: string): string | null {
  if (!SLUG_PATTERN.test(slug)) {
    return 'invalid slug format; expected owner/name';
  }
  return null;
}

function buildInstallCommand(slug: string): { command: string; args: string[] } {
  const base = (process.env.OPENCLAW_INSTALL_COMMAND ?? 'openclaw skill install').trim();
  const parts = base.split(/\s+/).filter(Boolean);
  const [command, ...args] = parts;
  const resolved = command ?? 'openclaw';

  if (!ALLOWED_BASE_COMMANDS.has(resolved)) {
    throw new Error(`disallowed install command: ${resolved}`);
  }

  // harden: only allow openclaw skill install (+ optional safe flags) as base
  if (args.length < 2 || args[0] !== STRICT_SUBCOMMAND[0] || args[1] !== STRICT_SUBCOMMAND[1]) {
    throw new Error('disallowed install subcommand: must start with "skill install"');
  }

  const extraArgs = args.slice(2);
  const safeExtra = extraArgs.filter((arg) => ['--global', '--yes', '-g', '-y'].includes(arg));

  return {
    command: resolved,
    args: [...STRICT_SUBCOMMAND, ...safeExtra, '--', slug]
  };
}

export function parseInstallCommandTimeoutMs(
  raw = process.env.INSTALL_COMMAND_TIMEOUT_MS,
  topology: InstallTopology = loadInstallTopologyFromEnv('single-instance')
): number {
  const cap = TOPOLOGY_TIMEOUT_CAP_MS[topology] ?? TOPOLOGY_TIMEOUT_CAP_MS['single-instance'];
  const parsed = Number(raw);
  if (!raw || !Number.isFinite(parsed) || parsed <= 0) {
    return Math.min(DEFAULT_INSTALL_TIMEOUT_MS, cap);
  }
  const rounded = Math.floor(parsed);
  return Math.max(MIN_INSTALL_TIMEOUT_MS, Math.min(cap, rounded));
}

type RunnerChild = {
  pid?: number;
  stdout: { on: (event: 'data', listener: (chunk: unknown) => void) => unknown };
  stderr: { on: (event: 'data', listener: (chunk: unknown) => void) => unknown };
  kill: (signal?: NodeJS.Signals) => boolean;
  on: (event: 'error' | 'close', listener: (...args: any[]) => void) => unknown;
};

type RunnerDeps = {
  spawnImpl?: (command: string, args: string[], options: { stdio: ['ignore', 'pipe', 'pipe']; detached: boolean }) => RunnerChild;
  processKill?: (pid: number, signal?: NodeJS.Signals | number) => boolean;
  topology?: InstallTopology;
};

export function createDefaultRunner(deps: RunnerDeps = {}): InstallRunner {
  return async (slug: string) => {
    const { command, args } = buildInstallCommand(slug);
    const timeoutMs = parseInstallCommandTimeoutMs(process.env.INSTALL_COMMAND_TIMEOUT_MS, deps.topology);

    return new Promise<InstallRunnerResult>((resolve) => {
      const startedAt = Date.now();
      const spawnImpl = deps.spawnImpl ?? ((command, args, options) => spawn(command, args, options));
      const processKill = deps.processKill ?? process.kill.bind(process);
      const useDetached = process.platform !== 'win32';
      const child = spawnImpl(command, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: useDetached
      });
      let stdout = '';
      let stderr = '';
      let settled = false;
      let timeoutTriggered = false;
      let timeoutHandle: NodeJS.Timeout | undefined;
      let graceHandle: NodeJS.Timeout | undefined;

      const finish = (result: InstallRunnerResult): void => {
        if (settled) return;
        settled = true;
        if (timeoutHandle) clearTimeout(timeoutHandle);
        if (graceHandle) clearTimeout(graceHandle);
        resolve(result);
      };

      child.stdout.on('data', (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk);
      });

      const killTreeOrChild = (signal: NodeJS.Signals): boolean => {
        const pid = child.pid;
        if (typeof pid === 'number' && pid > 0 && process.platform !== 'win32') {
          try {
            processKill(-pid, signal);
            return true;
          } catch {
            // fallback to legacy direct child signal when group signal fails
          }
        }

        try {
          return child.kill(signal);
        } catch {
          return false;
        }
      };

      timeoutHandle = setTimeout(() => {
        timeoutTriggered = true;
        const termSent = killTreeOrChild('SIGTERM');
        if (!termSent) {
          return;
        }

        graceHandle = setTimeout(() => {
          if (!settled) {
            killTreeOrChild('SIGKILL');
          }
        }, TERM_GRACE_MS);
      }, timeoutMs);

      child.on('error', (err) => {
        finish({
          code: null,
          stdout,
          stderr,
          error: timeoutTriggered ? 'timeout' : err.message,
          elapsedMs: Date.now() - startedAt,
          timeoutMs
        });
      });

      child.on('close', (code, signal) => {
        const elapsedMs = Date.now() - startedAt;
        if (timeoutTriggered) {
          finish({
            code,
            signal,
            stdout,
            stderr,
            error: 'timeout',
            elapsedMs,
            timeoutMs
          });
          return;
        }

        finish({ code, signal, stdout, stderr, elapsedMs, timeoutMs });
      });
    });
  };
}

function sanitizeSensitiveText(raw: string): string {
  return raw
    .replace(/\bovr1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED_OVERRIDE_TOKEN]')
    .replace(/\b([A-Z0-9_]*(?:TOKEN|SECRET)[A-Z0-9_]*)\s*=\s*([^\s,;]+)/gi, '$1=[REDACTED]')
    .replace(/("(?:token|secret)"\s*:\s*")([^"]+)(")/gi, '$1[REDACTED]$3')
    .replace(/('(?:token|secret)'\s*:\s*')([^']+)(')/gi, '$1[REDACTED]$3');
}

function sanitizeNotes(notes: string[]): string[] {
  return notes.map((note) => sanitizeSensitiveText(note));
}

function classifyErrorCode(outcome: InstallOutcome): string | undefined {
  if (outcome.status !== 'failed') {
    return undefined;
  }

  if (!outcome.error) {
    if (outcome.code && outcome.code !== 0) {
      return 'INSTALL_COMMAND_FAILED';
    }
    return undefined;
  }

  if (outcome.error === 'timeout') return 'INSTALL_TIMEOUT';
  if (outcome.error.includes('invalid slug format')) return 'INVALID_SLUG';
  if (outcome.error.includes('disallowed install')) return 'INSTALL_COMMAND_REJECTED';
  return 'INSTALL_RUNTIME_ERROR';
}

const INSTALL_AUDIT_LOCK_SUFFIX = '.lock';
const INSTALL_AUDIT_LOCK_TIMEOUT_MS = 1_000;
const INSTALL_AUDIT_LOCK_BACKOFF_MS = 10;
const DEFAULT_INSTALL_AUDIT_STALE_LOCK_MS = 60_000;
const MIN_INSTALL_AUDIT_STALE_LOCK_MS = 30_000;
const MAX_INSTALL_AUDIT_STALE_LOCK_MS = 120_000;

type InstallAuditPayload = Omit<InstallAuditEvent, 'hash'>;

type InstallAuditLockMeta = {
  pid: number;
  createdAt: string;
};

function parseInstallAuditStaleLockMs(raw = process.env.INSTALL_AUDIT_STALE_LOCK_MS): number {
  const parsed = Number(raw);
  if (!raw || !Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_INSTALL_AUDIT_STALE_LOCK_MS;
  }

  const rounded = Math.floor(parsed);
  return Math.max(MIN_INSTALL_AUDIT_STALE_LOCK_MS, Math.min(MAX_INSTALL_AUDIT_STALE_LOCK_MS, rounded));
}

function readInstallAuditLockCreatedAtMs(lockPath: string): number | undefined {
  try {
    const raw = readFileSync(lockPath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<InstallAuditLockMeta>;
    const createdAtMs = Date.parse(String(parsed.createdAt ?? ''));
    if (Number.isFinite(createdAtMs)) {
      return createdAtMs;
    }
  } catch {
    // no-op
  }

  return undefined;
}

function isInstallAuditLockStale(lockPath: string, staleLockMs: number, nowMs = Date.now()): boolean {
  try {
    const stats = statSync(lockPath);
    const createdAtMs = readInstallAuditLockCreatedAtMs(lockPath);
    const lockAgeMs = nowMs - Math.max(stats.mtimeMs, createdAtMs ?? 0);
    return lockAgeMs >= staleLockMs;
  } catch {
    return false;
  }
}

function blockForMs(ms: number): void {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    // intentional short sync backoff; keeps writeInstallAuditEvent fail-open and dependency-free
  }
}

function acquireInstallAuditLock(file: string): () => void {
  const lockPath = `${file}${INSTALL_AUDIT_LOCK_SUFFIX}`;
  const deadline = Date.now() + INSTALL_AUDIT_LOCK_TIMEOUT_MS;
  const staleLockMs = parseInstallAuditStaleLockMs();

  while (Date.now() <= deadline) {
    try {
      const fd = openSync(lockPath, 'wx');
      const lockMeta: InstallAuditLockMeta = {
        pid: process.pid,
        createdAt: new Date().toISOString()
      };
      writeSync(fd, JSON.stringify(lockMeta), undefined, 'utf8');

      return () => {
        try {
          closeSync(fd);
        } catch {
          // best effort close
        }
        try {
          unlinkSync(lockPath);
        } catch {
          // best effort unlock
        }
      };
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: string }).code) : undefined;
      if (code !== 'EEXIST') {
        throw error;
      }

      if (isInstallAuditLockStale(lockPath, staleLockMs)) {
        try {
          unlinkSync(lockPath);
          continue;
        } catch {
          // lock may be concurrently released/replaced; fall through to retry with backoff
        }
      }

      blockForMs(INSTALL_AUDIT_LOCK_BACKOFF_MS);
    }
  }

  throw new Error(`install audit lock timeout after ${INSTALL_AUDIT_LOCK_TIMEOUT_MS}ms`);
}

function readPreviousAuditHash(file: string): string {
  try {
    const raw = readFileSync(file, 'utf8');
    const lines = raw.split('\n');

    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const line = lines[i]?.trim();
      if (!line) continue;
      const parsed = JSON.parse(line) as Partial<InstallAuditEvent>;
      if (typeof parsed.hash === 'string' && parsed.hash.length > 0) {
        return parsed.hash;
      }
      break;
    }
  } catch {
    // no-op: missing file/invalid JSON falls back to genesis
  }

  return INSTALL_AUDIT_GENESIS_PREV_HASH;
}

function writeInstallAuditAnchorIfMissing(file: string): void {
  const anchorPath = getInstallAuditAnchorPath(file);
  const anchor = {
    createdAt: new Date().toISOString(),
    schemaVersion: INSTALL_AUDIT_SCHEMA_VERSION
  };

  try {
    writeFileSync(anchorPath, `${JSON.stringify(anchor)}\n`, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: string }).code) : undefined;
    if (code === 'EEXIST') {
      return;
    }
  }
}

export function writeInstallAuditEvent(event: Omit<InstallAuditEvent, 'hash' | 'prevHash' | 'eventId' | 'schemaVersion'>): void {
  let releaseLock: (() => void) | undefined;

  try {
    const file = getInstallAuditPath();
    mkdirSync(dirname(file), { recursive: true });

    releaseLock = acquireInstallAuditLock(file);

    const payload: InstallAuditPayload = {
      schemaVersion: INSTALL_AUDIT_SCHEMA_VERSION,
      eventId: randomUUID(),
      prevHash: readPreviousAuditHash(file),
      ...event
    };
    const signedEvent: InstallAuditEvent = {
      ...payload,
      hash: computeInstallAuditHash(payload)
    };

    appendFileSync(file, `${JSON.stringify(signedEvent)}\n`, 'utf8');
    writeInstallAuditAnchorIfMissing(file);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`[install-audit] failed to append JSONL event: ${sanitizeSensitiveText(reason)}`);
  } finally {
    releaseLock?.();
  }
}

function emitInstallAuditEvent(
  slug: string,
  plan: InstallPlan,
  outcome: InstallOutcome,
  options: RunInstallOptions = {}
): void {
  const topology = options.topology ?? loadInstallTopologyFromEnv('single-instance');
  const degraded = options.degraded ?? plan.notes.some((note) => note.includes('degraded mode'));

  const event: Omit<InstallAuditEvent, 'hash' | 'prevHash' | 'eventId' | 'schemaVersion'> = {
    ts: new Date().toISOString(),
    slug,
    policy: plan.policy,
    topology,
    originalDecision: plan.originalDecision,
    effectiveDecision: plan.effectiveDecision,
    action: plan.action,
    canInstall: plan.canInstall,
    status: outcome.status,
    errorCode: classifyErrorCode(outcome),
    timeoutMs: outcome.timeoutMs,
    elapsedMs: outcome.elapsedMs,
    degraded,
    notes: sanitizeNotes(plan.notes)
  };

  writeInstallAuditEvent(event);
}

export async function runInstall(
  slug: string,
  plan: InstallPlan,
  runner: InstallRunner = createDefaultRunner(),
  options: RunInstallOptions = {}
): Promise<InstallOutcome> {
  const commandPreview = `${process.env.OPENCLAW_INSTALL_COMMAND ?? 'openclaw skill install'} -- ${slug}`;

  if (!plan.canInstall) {
    const skipped: InstallOutcome = {
      slug,
      action: plan.action,
      attempted: false,
      installed: false,
      status: 'skipped',
      error: plan.notes.join('; ')
    };
    emitInstallAuditEvent(slug, plan, skipped, options);
    return skipped;
  }

  const slugError = validateSlug(slug);
  if (slugError) {
    const invalidSlug: InstallOutcome = {
      slug,
      action: plan.action,
      attempted: false,
      installed: false,
      status: 'failed',
      error: slugError
    };
    emitInstallAuditEvent(slug, plan, invalidSlug, options);
    return invalidSlug;
  }

  try {
    const run = await runner(slug);
    const success = run.code === 0 && !run.error;

    const outcome: InstallOutcome = {
      slug,
      action: plan.action,
      attempted: true,
      installed: success,
      status: success ? 'installed' : 'failed',
      command: sanitizeSensitiveText(commandPreview),
      code: run.code,
      signal: run.signal,
      stdout: run.stdout,
      stderr: run.stderr,
      error: run.error ? sanitizeSensitiveText(run.error) : undefined,
      elapsedMs: run.elapsedMs,
      timeoutMs: run.timeoutMs
    };
    emitInstallAuditEvent(slug, plan, outcome, options);
    return outcome;
  } catch (error) {
    const reason = sanitizeSensitiveText(error instanceof Error ? error.message : String(error));
    const failed: InstallOutcome = {
      slug,
      action: plan.action,
      attempted: false,
      installed: false,
      status: 'failed',
      command: sanitizeSensitiveText(commandPreview),
      error: reason
    };
    emitInstallAuditEvent(slug, plan, failed, options);
    return failed;
  }
}
