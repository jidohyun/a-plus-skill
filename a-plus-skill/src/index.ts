import { createHash, randomBytes } from 'node:crypto';
import { appendFileSync, closeSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { fetchCandidateSkills } from './collector/clawhubClient.js';
import { loadInstallPolicyContextFromEnv, loadInstallTopologyFromEnv, loadPolicyFromEnv } from './install/confirm.js';
import { runInstall } from './install/openclawInstaller.js';
import { getInstallAuditPath, verifyInstallAuditFile } from './install/auditIntegrity.js';
import type { InstallAuditVerifyResult } from './install/auditIntegrity.js';
import { decide, planInstallAction } from './policy/policyEngine.js';
import { validateOverrideSecurityPosture } from './policy/overrideNonceStore.js';
import { buildReasons } from './recommender/explain.js';
import {
  calculateFinalScore,
  calculateFitScore,
  calculateStabilityScore,
  calculateTrendScore
} from './recommender/scoring.js';
import { renderWeeklyReport } from './report/weeklyReport.js';
import { sendWeeklyReport } from './delivery/reportSender.js';
import { securityScore } from './security/riskScoring.js';
import type { InstallOutcome, InstallPlan, Policy, ProfileConfig, RecommendationResult } from './types/index.js';
import { getSafeDefaultProfile, normalizeRegistry, resolveProfile } from './profile/normalize.js';

const currentDir = dirname(fileURLToPath(import.meta.url));
const profileConfigPath = resolve(currentDir, '../config/profile.default.json');

export async function loadProfile(): Promise<ProfileConfig> {
  try {
    const fileContent = await readFile(profileConfigPath, 'utf8');
    const rawRegistry = JSON.parse(fileContent) as unknown;
    const registry = normalizeRegistry(rawRegistry, (msg) => console.warn(msg));
    return resolveProfile(registry, process.env.PROFILE_TYPE, (msg) => console.warn(msg));
  } catch (error) {
    console.warn('[profile] failed to load/parse profile config; fallback to safe default profile (developer)', error);
    return getSafeDefaultProfile();
  }
}

export function parseInstallTimeoutRecoveryDelayMs(raw = process.env.INSTALL_TIMEOUT_RECOVERY_DELAY_MS): number {
  const defaultDelayMs = 250;
  const minDelayMs = 0;
  const maxDelayMs = 2_000;
  const parsed = Number(raw);
  if (!raw || !Number.isFinite(parsed) || parsed < 0) {
    return defaultDelayMs;
  }
  const rounded = Math.floor(parsed);
  return Math.max(minDelayMs, Math.min(maxDelayMs, rounded));
}

export function shouldRecoverAfterInstallTimeout(outcome?: InstallOutcome): boolean {
  if (!outcome) return false;
  return outcome.error === 'timeout' || outcome.signal === 'SIGKILL';
}

export async function waitForInstallTimeoutRecovery(
  outcome: InstallOutcome,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
): Promise<number> {
  if (!shouldRecoverAfterInstallTimeout(outcome)) {
    return 0;
  }

  const delayMs = parseInstallTimeoutRecoveryDelayMs();
  if (delayMs > 0) {
    await sleep(delayMs);
  }
  return delayMs;
}

export function parseFastAuditFailMaxInstalls(raw = process.env.FAST_AUDIT_FAIL_MAX_INSTALLS): number {
  const defaultCap = 3;
  const minCap = 1;
  const maxCap = 20;
  const parsed = Number(raw);
  if (!raw || !Number.isFinite(parsed) || parsed <= 0) {
    return defaultCap;
  }
  const rounded = Math.floor(parsed);
  return Math.max(minCap, Math.min(maxCap, rounded));
}

export type InstallOpsEventAppendResult = {
  ok: boolean;
  path: string;
  error?: string;
};

export function appendInstallOpsEvent(
  event: {
    policy: Policy;
    reason: string;
    line: number;
    action: 'abort' | 'demote';
    auditPath: string;
    notes?: string[];
  },
  targetPath = resolve(process.cwd(), 'data', 'install-ops-events.jsonl')
): InstallOpsEventAppendResult {
  try {
    mkdirSync(dirname(targetPath), { recursive: true });
    appendFileSync(
      targetPath,
      `${JSON.stringify({
        ts: new Date().toISOString(),
        ...event
      })}\n`,
      'utf8'
    );
    return { ok: true, path: targetPath };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, path: targetPath, error: reason };
  }
}

const FAST_AUDIT_FAIL_CAP_STATE_PATH = resolve(process.cwd(), 'data', 'fast-audit-fail-cap.json');
const FAST_AUDIT_FAIL_CAP_KEY_PATH = resolve(process.cwd(), 'data', 'fast-audit-fail-cap.key');

function getFastAuditFailCapKeyPath(statePath = FAST_AUDIT_FAIL_CAP_STATE_PATH): string {
  if (statePath === FAST_AUDIT_FAIL_CAP_STATE_PATH) return FAST_AUDIT_FAIL_CAP_KEY_PATH;
  return resolve(dirname(statePath), 'fast-audit-fail-cap.key');
}
const FAST_AUDIT_FAIL_CAP_SCHEMA_VERSION = 1;
const FAST_AUDIT_FAIL_CAP_LOCK_TIMEOUT_MS = 1_000;
const STRICT_EVIDENCE_FAIL_STATE_PATH = resolve(process.cwd(), 'data', 'strict-evidence-fail-state.json');

type FastAuditFailCapState = {
  schemaVersion: number;
  count: number;
  updatedAt: string;
  checksum: string;
};

type StrictEvidenceFailState = {
  schemaVersion: number;
  consecutiveFailures: number;
  updatedAt: string;
};

function withFileLock(lockPath: string, fn: () => void): void {
  const deadline = Date.now() + FAST_AUDIT_FAIL_CAP_LOCK_TIMEOUT_MS;

  while (Date.now() <= deadline) {
    try {
      const fd = openSync(lockPath, 'wx');
      try {
        fn();
      } finally {
        try {
          closeSync(fd);
        } catch {
          // best effort
        }
        try {
          unlinkSync(lockPath);
        } catch {
          // best effort
        }
      }
      return;
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: string }).code) : undefined;
      if (code !== 'EEXIST') {
        throw error;
      }
    }
  }

  throw new Error(`file lock timeout (${lockPath})`);
}

function computeFastAuditCapChecksum(key: string, schemaVersion: number, count: number, updatedAt: string): string {
  return createHash('sha256').update(`${schemaVersion}:${count}:${updatedAt}:${key}`, 'utf8').digest('hex');
}

function ensureFastAuditCapKey(keyPath = FAST_AUDIT_FAIL_CAP_KEY_PATH): string {
  mkdirSync(dirname(keyPath), { recursive: true });

  try {
    const existing = readFileSync(keyPath, 'utf8').trim();
    if (existing) return existing;
  } catch {
    // continue and create key
  }

  const key = randomBytes(32).toString('hex');
  try {
    writeFileSync(keyPath, `${key}\n`, { encoding: 'utf8', flag: 'wx' });
    return key;
  } catch {
    return readFileSync(keyPath, 'utf8').trim();
  }
}

function readStrictEvidenceFailState(path = STRICT_EVIDENCE_FAIL_STATE_PATH): StrictEvidenceFailState {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<StrictEvidenceFailState>;
    const consecutiveFailures = Number(parsed.consecutiveFailures);
    return {
      schemaVersion: 1,
      consecutiveFailures: Number.isFinite(consecutiveFailures) && consecutiveFailures > 0 ? Math.floor(consecutiveFailures) : 0,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date(0).toISOString()
    };
  } catch {
    return { schemaVersion: 1, consecutiveFailures: 0, updatedAt: new Date(0).toISOString() };
  }
}

function writeStrictEvidenceFailState(state: StrictEvidenceFailState, path = STRICT_EVIDENCE_FAIL_STATE_PATH): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export function parseStrictEvidenceFailOpenMax(raw = process.env.STRICT_EVIDENCE_FAIL_OPEN_MAX): number {
  const parsed = Number(raw);
  if (!raw || !Number.isFinite(parsed)) return 2;
  return Math.max(1, Math.min(5, Math.floor(parsed)));
}

function readFastAuditFailCapState(
  statePath = FAST_AUDIT_FAIL_CAP_STATE_PATH,
  keyPath = getFastAuditFailCapKeyPath(statePath)
): { count: number; tampered: boolean; reason?: string } {
  const keyExists = (() => {
    try {
      return readFileSync(keyPath, 'utf8').trim().length > 0;
    } catch {
      return false;
    }
  })();

  let raw = '';
  try {
    raw = readFileSync(statePath, 'utf8');
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: string }).code) : undefined;
    if (code === 'ENOENT') {
      if (keyExists) {
        return { count: 0, tampered: true, reason: 'suspicious fast-cap reset: key exists while state missing' };
      }
      return { count: 0, tampered: false };
    }
    return { count: 0, tampered: true, reason: 'fast-cap state read failed' };
  }

  const key = ensureFastAuditCapKey(keyPath);
  try {
    const parsed = JSON.parse(raw) as Partial<FastAuditFailCapState>;
    const count = Number(parsed.count);
    const schemaVersion = Number(parsed.schemaVersion);
    const updatedAt = String(parsed.updatedAt ?? '');
    const checksum = String(parsed.checksum ?? '');
    if (!Number.isFinite(count) || count < 0 || schemaVersion !== FAST_AUDIT_FAIL_CAP_SCHEMA_VERSION || !updatedAt || !checksum) {
      return { count: 0, tampered: true, reason: 'fast-cap state schema invalid' };
    }

    const expectedChecksum = computeFastAuditCapChecksum(key, schemaVersion, Math.floor(count), updatedAt);
    if (expectedChecksum !== checksum) {
      return { count: 0, tampered: true, reason: 'fast-cap checksum mismatch' };
    }

    return { count: Math.floor(count), tampered: false };
  } catch {
    return { count: 0, tampered: true, reason: 'fast-cap state parse failed' };
  }
}

function writeFastAuditFailCapState(
  count: number,
  statePath = FAST_AUDIT_FAIL_CAP_STATE_PATH,
  keyPath = getFastAuditFailCapKeyPath(statePath)
): void {
  mkdirSync(dirname(statePath), { recursive: true });
  const key = ensureFastAuditCapKey(keyPath);
  const updatedAt = new Date().toISOString();
  const state: FastAuditFailCapState = {
    schemaVersion: FAST_AUDIT_FAIL_CAP_SCHEMA_VERSION,
    count,
    updatedAt,
    checksum: computeFastAuditCapChecksum(key, FAST_AUDIT_FAIL_CAP_SCHEMA_VERSION, count, updatedAt)
  };
  const tmpPath = `${statePath}.tmp.${process.pid}`;
  writeFileSync(tmpPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  renameSync(tmpPath, statePath);
}

export function consumeFastAuditFailInstallCap(
  policy: Policy,
  installPlan: InstallPlan,
  auditIntegrity: InstallAuditVerifyResult,
  maxInstallsOnAuditFailure = parseFastAuditFailMaxInstalls(),
  statePath = FAST_AUDIT_FAIL_CAP_STATE_PATH,
  keyPath = getFastAuditFailCapKeyPath(statePath)
): { plan: InstallPlan; count: number; cap: number; demotedByCap: boolean } {
  if (policy !== 'fast' || auditIntegrity.ok || !installPlan.canInstall) {
    return { plan: installPlan, count: 0, cap: maxInstallsOnAuditFailure, demotedByCap: false };
  }

  let nextCount = 1;
  let tamperedReason: string | undefined;
  const lockPath = `${statePath}.lock`;

  withFileLock(lockPath, () => {
    const current = readFastAuditFailCapState(statePath, keyPath);
    if (current.tampered) {
      tamperedReason = current.reason ?? 'fast-cap tamper detected';
      nextCount = maxInstallsOnAuditFailure + 1;
    } else {
      nextCount = current.count + 1;
    }

    writeFastAuditFailCapState(nextCount, statePath, keyPath);
  });

  if (tamperedReason) {
    appendInstallOpsEvent({
      policy,
      reason: tamperedReason,
      line: auditIntegrity.line,
      action: 'demote',
      auditPath: getInstallAuditPath(),
      notes: [`statePath=${statePath}`]
    });
  }

  if (nextCount <= maxInstallsOnAuditFailure) {
    return { plan: installPlan, count: nextCount, cap: maxInstallsOnAuditFailure, demotedByCap: false };
  }

  return {
    plan: {
      ...installPlan,
      action: 'skip-install',
      canInstall: false,
      notes: [
        ...installPlan.notes,
        `audit integrity gate: fast install cap exceeded (${nextCount}/${maxInstallsOnAuditFailure}), demoted to skip-install`
      ]
    },
    count: nextCount,
    cap: maxInstallsOnAuditFailure,
    demotedByCap: true
  };
}

export function toAuditIntegrityNotes(result: InstallAuditVerifyResult): string[] {
  if (result.ok) {
    return ['audit_integrity=ok'];
  }

  return [
    'audit_integrity=failed',
    `audit_integrity_reason=${result.reason}`,
    `audit_integrity_line=${result.line}`
  ];
}

export function applyAuditIntegrityGate(policy: Policy, installPlan: InstallPlan, auditIntegrity: InstallAuditVerifyResult): InstallPlan {
  const auditIntegrityNotes = toAuditIntegrityNotes(auditIntegrity);

  if (auditIntegrity.ok) {
    return {
      ...installPlan,
      notes: [...installPlan.notes, ...auditIntegrityNotes]
    };
  }

  if (policy === 'balanced') {
    return {
      ...installPlan,
      action: 'skip-install',
      canInstall: false,
      notes: [
        ...installPlan.notes,
        'audit integrity gate: balanced policy demoted this run to skip-install',
        `audit integrity failure line=${auditIntegrity.line} reason=${auditIntegrity.reason}`,
        ...auditIntegrityNotes
      ]
    };
  }

  return {
    ...installPlan,
    notes: [...installPlan.notes, ...auditIntegrityNotes]
  };
}

export function enforceAuditIntegrityPolicy(policy: Policy, auditIntegrity: InstallAuditVerifyResult, auditPath: string): void {
  if (auditIntegrity.ok) return;

  const gateMessage = `install audit integrity check failed (path=${auditPath}, line=${auditIntegrity.line}, reason=${auditIntegrity.reason})`;
  const fallbackOpsPath = resolve(process.cwd(), 'data', 'install-ops-events.fallback.jsonl');
  const action = policy === 'strict' ? 'abort' : 'demote';
  const primaryWrite = appendInstallOpsEvent({
    policy,
    reason: auditIntegrity.reason,
    line: auditIntegrity.line,
    action,
    auditPath
  });

  let fallbackWrite: InstallOpsEventAppendResult | undefined;
  if (!primaryWrite.ok) {
    fallbackWrite = appendInstallOpsEvent(
      {
        policy,
        reason: auditIntegrity.reason,
        line: auditIntegrity.line,
        action,
        auditPath,
        notes: [`primary_failed=${primaryWrite.error ?? 'unknown'}`]
      },
      fallbackOpsPath
    );
  }

  if (policy === 'strict') {
    if (!primaryWrite.ok && !fallbackWrite?.ok) {
      const maxFailOpen = parseStrictEvidenceFailOpenMax();
      const current = readStrictEvidenceFailState();
      const nextFailures = current.consecutiveFailures + 1;
      writeStrictEvidenceFailState({
        schemaVersion: 1,
        consecutiveFailures: nextFailures,
        updatedAt: new Date().toISOString()
      });

      if (nextFailures <= maxFailOpen) {
        console.warn(
          `[strict] ${gateMessage}; ops evidence write failed but within resilience window (${nextFailures}/${maxFailOpen}) primary=${primaryWrite.error ?? 'unknown'} fallback=${fallbackWrite?.error ?? 'unknown'}`
        );
        throw new Error(`[strict] ${gateMessage}`);
      }

      throw new Error(
        `[strict] ${gateMessage}; ops_evidence_write_failed primary=${primaryWrite.error ?? 'unknown'} fallback=${fallbackWrite?.error ?? 'unknown'}`
      );
    }

    writeStrictEvidenceFailState({
      schemaVersion: 1,
      consecutiveFailures: 0,
      updatedAt: new Date().toISOString()
    });
    throw new Error(`[strict] ${gateMessage}`);
  }

  if (policy === 'balanced') {
    if (!primaryWrite.ok && !fallbackWrite?.ok) {
      console.warn(
        `[balanced] ${gateMessage}; demoting all installs to skip-install; evidence write failed primary=${primaryWrite.error ?? 'unknown'} fallback=${fallbackWrite?.error ?? 'unknown'}`
      );
    } else if (!primaryWrite.ok && fallbackWrite?.ok) {
      console.warn(
        `[balanced] ${gateMessage}; demoting all installs to skip-install; evidence fallback written (${fallbackWrite.path}), primary failed (${primaryWrite.error ?? 'unknown'})`
      );
    } else {
      console.warn(`[balanced] ${gateMessage}; demoting all installs to skip-install`);
    }
  } else {
    console.warn(`[fast] ${gateMessage}; proceeding with warning`);
  }
}

export async function main() {
  const profile = await loadProfile();
  const { skills, meta } = await fetchCandidateSkills();
  const policy = loadPolicyFromEnv('balanced');
  const topology = loadInstallTopologyFromEnv('single-instance');
  validateOverrideSecurityPosture({ topology, policy });

  const installContext = loadInstallPolicyContextFromEnv();
  const auditPath = getInstallAuditPath();
  const auditIntegrity = verifyInstallAuditFile(auditPath);
  enforceAuditIntegrityPolicy(policy, auditIntegrity, auditPath);

  const results: RecommendationResult[] = [];
  const fastAuditFailMaxInstalls = parseFastAuditFailMaxInstalls();

  for (let i = 0; i < skills.length; i += 1) {
    const s = skills[i]!;
    const fitScore = calculateFitScore(s, profile);
    const trendScore = calculateTrendScore(s);
    const stabilityScore = calculateStabilityScore(s);
    const security = securityScore(s);
    const finalScore = calculateFinalScore({
      fit: fitScore,
      trend: trendScore,
      stability: stabilityScore,
      security
    });

    const policyDecision = decide(policy, finalScore, security);
    const installPlanBase = planInstallAction(policy, policyDecision, {
      ...installContext,
      degraded: meta.degraded
    });

    const installPlanWithGate = applyAuditIntegrityGate(policy, installPlanBase, auditIntegrity);
    const fastCap = consumeFastAuditFailInstallCap(policy, installPlanWithGate, auditIntegrity, fastAuditFailMaxInstalls);
    const installPlan = fastCap.plan;

    if (policy === 'fast' && fastCap.demotedByCap) {
      appendInstallOpsEvent({
        policy,
        reason: 'fast audit failure cap exceeded',
        line: auditIntegrity.line,
        action: 'demote',
        auditPath,
        notes: [`count=${fastCap.count}`, `cap=${fastCap.cap}`, `slug=${s.slug}`]
      });
    }

    const reasons = buildReasons({ fitScore, trendScore, securityScore: security });
    if (meta.degraded) {
      reasons.push('실데이터 수집 저하 상태: fallback 모드');
    }
    reasons.push(...installPlan.notes);

    const installOutcome = await runInstall(s.slug, installPlan, undefined, {
      topology,
      degraded: meta.degraded
    });

    results.push({
      slug: s.slug,
      fitScore,
      trendScore,
      stabilityScore,
      securityScore: Math.round(security),
      finalScore,
      decision: installPlan.effectiveDecision,
      reasons,
      installAction: installPlan.action,
      installOutcome
    });

    if (i < skills.length - 1) {
      await waitForInstallTimeoutRecovery(installOutcome);
    }
  }

  const report = renderWeeklyReport(results, meta);
  console.log(report);

  const delivery = await sendWeeklyReport(report, meta);
  if (!delivery.skipped && !delivery.success) {
    console.error(`[delivery] report send failed: ${delivery.reason ?? 'unknown'}`);
    const failHard = (process.env.REPORT_DELIVERY_FAIL_HARD ?? 'true').trim().toLowerCase();
    if (failHard === 'true' || failHard === '1' || failHard === 'yes') {
      throw new Error(`delivery_failed: ${delivery.reason ?? 'unknown'}`);
    }
  }
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : undefined;
if (entry && import.meta.url === entry) {
  main().catch((err) => {
    console.error('A+ run failed:', err);
    process.exit(1);
  });
}
