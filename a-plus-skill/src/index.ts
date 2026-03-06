import { fetchCandidateSkills } from './collector/clawhubClient.js';
import { decide } from './policy/policyEngine.js';
import { buildReasons } from './recommender/explain.js';
import { calculateFinalScore } from './recommender/scoring.js';
import { renderWeeklyReport } from './report/weeklyReport.js';
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
  const results: RecommendationResult[] = skills.map((s) => {
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

    const policyDecision = decide('balanced', finalScore, security);
    const decision = meta.degraded ? 'hold' : policyDecision;

    const reasons = buildReasons({ fitScore, trendScore, securityScore: security });
    if (meta.degraded) {
      reasons.push(`실데이터 수집 저하 상태: ${meta.fallbackReason ?? 'unknown'}`);
    }

    return {
      slug: s.slug,
      fitScore,
      trendScore,
      stabilityScore,
      securityScore: Math.round(security),
      finalScore,
      decision,
      reasons
    };
  });

  console.log(renderWeeklyReport(results, meta));
}

main().catch((err) => {
  console.error('A+ run failed:', err);
  process.exit(1);
});
