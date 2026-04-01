import { fetchCandidateSkills } from '../../collector/clawhubClient.js';
import { loadInstallPolicyContextFromEnv, loadInstallTopologyFromEnv, loadPolicyFromEnv } from '../../install/confirm.js';
import { getInstallAuditPath, verifyInstallAuditFile } from '../../install/auditIntegrity.js';
import { runInstall } from '../../install/openclawInstaller.js';
import { decide, planInstallAction } from '../../policy/policyEngine.js';
import { validateOverrideSecurityPosture } from '../../policy/overrideNonceStore.js';
import { getSafeDefaultProfile, normalizeRegistry, resolveProfile } from '../../profile/normalize.js';
import { buildReasons } from '../../recommender/explain.js';
import { calculateFinalScore, calculateFitScore, calculateStabilityScore, calculateTrendScore } from '../../recommender/scoring.js';
import { renderWeeklyReport } from '../../report/weeklyReport.js';
import { securityScore } from '../../security/riskScoring.js';
import type { CollectorMeta, InstallOutcome, Policy, ProfileConfig, ProfileType, RecommendationResult } from '../../types/index.js';
import {
  appendInstallOpsEvent,
  applyAuditIntegrityGate,
  consumeFastAuditFailInstallCap,
  enforceAuditIntegrityPolicy,
  loadProfile,
  parseFastAuditFailMaxInstalls,
  shouldRecoverAfterInstallTimeout,
  waitForInstallTimeoutRecovery
} from '../../index.js';
import { sendWeeklyReport } from '../../delivery/reportSender.js';

export type RecommendationBatchOptions = {
  install?: boolean;
  deliver?: boolean;
  profile?: ProfileConfig;
  profileType?: ProfileType;
  policy?: Policy;
};

export type RecommendationBatchResult = {
  profile: ProfileConfig;
  policy: Policy;
  results: RecommendationResult[];
  meta: CollectorMeta;
  report: string;
  delivery?: Awaited<ReturnType<typeof sendWeeklyReport>>;
};

export async function runRecommendationBatch(options: RecommendationBatchOptions = {}): Promise<RecommendationBatchResult> {
  const loadedProfile = await loadProfile();
  const profile = options.profile
    ? options.profile
    : options.profileType && loadedProfile.type !== options.profileType
      ? { ...loadedProfile, type: options.profileType }
      : loadedProfile;
  const { skills, meta } = await fetchCandidateSkills();
  const policy = options.policy ?? loadPolicyFromEnv('balanced');
  const topology = loadInstallTopologyFromEnv('single-instance');
  validateOverrideSecurityPosture({ topology, policy });

  const installEnabled = options.install ?? true;
  const deliverEnabled = options.deliver ?? true;
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
    const installPlan = installEnabled
      ? fastCap.plan
      : {
          ...fastCap.plan,
          action: 'skip-install' as const,
          canInstall: false,
          notes: [...fastCap.plan.notes, 'install execution disabled for read-only batch']
        };

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

    let installOutcome: InstallOutcome | undefined;
    if (installEnabled) {
      installOutcome = await runInstall(s.slug, installPlan, undefined, {
        topology,
        degraded: meta.degraded
      });
    }

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

    if (installEnabled && installOutcome && i < skills.length - 1 && shouldRecoverAfterInstallTimeout(installOutcome)) {
      await waitForInstallTimeoutRecovery(installOutcome);
    }
  }

  const report = renderWeeklyReport(results, meta);
  const delivery = deliverEnabled ? await sendWeeklyReport(report, meta) : undefined;

  return {
    profile,
    policy,
    results,
    meta,
    report,
    delivery
  };
}
