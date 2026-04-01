import { fetchCandidateSkills } from '../../collector/clawhubClient.js';
import { loadInstallPolicyContextFromEnv, loadPolicyFromEnv } from '../../install/confirm.js';
import { getInstallAuditPath, verifyInstallAuditFile } from '../../install/auditIntegrity.js';
import { decide, planInstallAction } from '../../policy/policyEngine.js';
import { buildReasons } from '../../recommender/explain.js';
import { calculateFinalScore, calculateFitScore, calculateStabilityScore, calculateTrendScore } from '../../recommender/scoring.js';
import { securityScore } from '../../security/riskScoring.js';
import type { Policy, ProfileType } from '../../types/index.js';
import { applyAuditIntegrityGate, consumeFastAuditFailInstallCap, enforceAuditIntegrityPolicy, loadProfile, parseFastAuditFailMaxInstalls } from '../../index.js';

export type InstallPlanReportItem = {
  slug: string;
  decision: 'recommend' | 'caution' | 'hold' | 'block';
  installAction: 'auto-install' | 'override-install' | 'confirm-install' | 'skip-install';
  canInstall: boolean;
  finalScore: number;
  securityScore: number;
  notes: string[];
  reasons: string[];
};

export type InstallPlanReport = {
  policy: Policy;
  profileType: ProfileType;
  source: 'live' | 'fallback';
  degraded: boolean;
  fallbackReason?: string;
  fetchedAt: string;
  items: InstallPlanReportItem[];
};

export async function getInstallPlanReport(options: { policy?: Policy; profileType?: ProfileType } = {}): Promise<InstallPlanReport> {
  const loadedProfile = await loadProfile();
  const profile = options.profileType && loadedProfile.type !== options.profileType ? { ...loadedProfile, type: options.profileType } : loadedProfile;
  const policy = options.policy ?? loadPolicyFromEnv('balanced');
  const installContext = loadInstallPolicyContextFromEnv();
  const auditPath = getInstallAuditPath();
  const auditIntegrity = verifyInstallAuditFile(auditPath);
  enforceAuditIntegrityPolicy(policy, auditIntegrity, auditPath);
  const fastAuditFailMaxInstalls = parseFastAuditFailMaxInstalls();
  const { skills, meta } = await fetchCandidateSkills();

  const items: InstallPlanReportItem[] = [];
  for (const skill of skills) {
    const fitScore = calculateFitScore(skill, profile);
    const trendScore = calculateTrendScore(skill);
    const stabilityScore = calculateStabilityScore(skill);
    const security = securityScore(skill);
    const finalScore = calculateFinalScore({ fit: fitScore, trend: trendScore, stability: stabilityScore, security });
    const decision = decide(policy, finalScore, security);
    const installPlanBase = planInstallAction(policy, decision, {
      ...installContext,
      degraded: meta.degraded
    });
    const installPlanWithGate = applyAuditIntegrityGate(policy, installPlanBase, auditIntegrity);
    const fastCap = consumeFastAuditFailInstallCap(policy, installPlanWithGate, auditIntegrity, fastAuditFailMaxInstalls);
    const reasons = buildReasons({ fitScore, trendScore, securityScore: security });
    if (meta.degraded) reasons.push('실데이터 수집 저하 상태: fallback 모드');
    reasons.push(...fastCap.plan.notes);

    items.push({
      slug: skill.slug,
      decision: fastCap.plan.effectiveDecision,
      installAction: fastCap.plan.action,
      canInstall: fastCap.plan.canInstall,
      finalScore,
      securityScore: Math.round(security),
      notes: [...fastCap.plan.notes],
      reasons
    });
  }

  return {
    policy,
    profileType: profile.type,
    source: meta.source,
    degraded: meta.degraded,
    fallbackReason: meta.fallbackReason,
    fetchedAt: meta.fetchedAt,
    items
  };
}
