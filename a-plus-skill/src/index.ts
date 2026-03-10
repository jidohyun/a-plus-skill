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
  if (policy === 'strict') {
    throw new Error(`[strict] ${gateMessage}`);
  }

  if (policy === 'balanced') {
    console.warn(`[balanced] ${gateMessage}; demoting all installs to skip-install`);
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

    const installPlan = applyAuditIntegrityGate(policy, installPlanBase, auditIntegrity);

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
