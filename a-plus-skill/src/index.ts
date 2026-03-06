import { fetchCandidateSkills } from './collector/clawhubClient.js';
import { loadInstallPolicyContextFromEnv, loadPolicyFromEnv } from './install/confirm.js';
import { runInstall } from './install/openclawInstaller.js';
import { decide, planInstallAction } from './policy/policyEngine.js';
import { buildReasons } from './recommender/explain.js';
import { calculateFinalScore } from './recommender/scoring.js';
import { renderWeeklyReport } from './report/weeklyReport.js';
import { sendWeeklyReport } from './delivery/reportSender.js';
import { securityScore } from './security/riskScoring.js';
import type { RecommendationResult } from './types/index.js';

function pseudoFit(slug: string) {
  return slug.includes('weather') ? 82 : 70;
}

function pseudoTrend(downloads: number) {
  return Math.min(95, Math.round(downloads / 1000));
}

function pseudoStability(versions: number) {
  return Math.min(90, 50 + versions * 3);
}

async function main() {
  const { skills, meta } = await fetchCandidateSkills();
  const policy = loadPolicyFromEnv('balanced');
  const installContext = loadInstallPolicyContextFromEnv();

  const results: RecommendationResult[] = [];

  for (const s of skills) {
    const fitScore = pseudoFit(s.slug);
    const trendScore = pseudoTrend(s.downloads);
    const stabilityScore = pseudoStability(s.versions);
    const security = securityScore(s);
    const finalScore = calculateFinalScore({
      fit: fitScore,
      trend: trendScore,
      stability: stabilityScore,
      security
    });

    const policyDecision = decide(policy, finalScore, security);
    const installPlan = planInstallAction(policy, policyDecision, {
      ...installContext,
      degraded: meta.degraded
    });

    const reasons = buildReasons({ fitScore, trendScore, securityScore: security });
    if (meta.degraded) {
      reasons.push(`실데이터 수집 저하 상태: ${meta.fallbackReason ?? 'unknown'}`);
    }
    reasons.push(...installPlan.notes);

    const installOutcome = await runInstall(s.slug, installPlan);

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
  }

  const report = renderWeeklyReport(results, meta);
  console.log(report);

  const delivery = await sendWeeklyReport(report, meta);
  if (!delivery.skipped && !delivery.success) {
    console.warn(`[delivery] report send failed: ${delivery.reason ?? 'unknown'}`);
  }
}

main().catch((err) => {
  console.error('A+ run failed:', err);
  process.exit(1);
});
