import { loadPolicyFromEnv } from '../../install/confirm.js';
import { decide } from '../../policy/policyEngine.js';
import { calculateFinalScore, calculateFitScore, calculateStabilityScore, calculateTrendScore } from '../../recommender/scoring.js';
import { securityScore } from '../../security/riskScoring.js';
import { loadProfile } from '../../index.js';
import { fetchCandidateSkills } from '../../collector/clawhubClient.js';

export type ScoreStats = {
  min: number;
  p50: number;
  p90: number;
  max: number;
  avg: number;
};

export type ScoringCalibrationResult = {
  summary: {
    policy: string;
    source: string;
    degraded: boolean;
    skill_count: number;
    sample_quality: 'limited' | 'normal';
    note: string;
  };
  distributions: {
    fit: ScoreStats;
    trend: ScoreStats;
    stability: ScoreStats;
    security: ScoreStats;
    final: ScoreStats;
  };
  decision_counts: {
    recommend: number;
    caution: number;
    hold: number;
    block: number;
  };
};

export function summarizeStats(values: number[]): ScoreStats {
  if (values.length === 0) {
    return { min: 0, p50: 0, p90: 0, max: 0, avg: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const pick = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))] ?? 0;
  const avg = sorted.reduce((sum, n) => sum + n, 0) / sorted.length;
  return {
    min: Number((sorted[0] ?? 0).toFixed(1)),
    p50: Number(pick(0.5).toFixed(1)),
    p90: Number(pick(0.9).toFixed(1)),
    max: Number((sorted.at(-1) ?? 0).toFixed(1)),
    avg: Number(avg.toFixed(1))
  };
}

function increment(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

export async function getScoringCalibration(): Promise<ScoringCalibrationResult> {
  const profile = await loadProfile();
  const policy = loadPolicyFromEnv('balanced');
  const { skills, meta } = await fetchCandidateSkills();

  const fitScores: number[] = [];
  const trendScores: number[] = [];
  const stabilityScores: number[] = [];
  const securityScores: number[] = [];
  const finalScores: number[] = [];
  const decisionCounts = new Map<string, number>();

  for (const skill of skills) {
    const fit = calculateFitScore(skill, profile);
    const trend = calculateTrendScore(skill);
    const stability = calculateStabilityScore(skill);
    const security = securityScore(skill);
    const final = calculateFinalScore({ fit, trend, stability, security });
    const decision = decide(policy, final, security);

    fitScores.push(fit);
    trendScores.push(trend);
    stabilityScores.push(stability);
    securityScores.push(security);
    finalScores.push(final);
    increment(decisionCounts, decision);
  }

  const sampleQuality = meta.degraded || skills.length < 5 ? 'limited' : 'normal';

  return {
    summary: {
      policy,
      source: meta.source,
      degraded: meta.degraded,
      skill_count: skills.length,
      sample_quality: sampleQuality,
      note:
        sampleQuality === 'limited'
          ? 'collector fallback or low sample count; use calibration output conservatively'
          : 'live sample looks sufficient for directional calibration'
    },
    distributions: {
      fit: summarizeStats(fitScores),
      trend: summarizeStats(trendScores),
      stability: summarizeStats(stabilityScores),
      security: summarizeStats(securityScores),
      final: summarizeStats(finalScores)
    },
    decision_counts: {
      recommend: decisionCounts.get('recommend') ?? 0,
      caution: decisionCounts.get('caution') ?? 0,
      hold: decisionCounts.get('hold') ?? 0,
      block: decisionCounts.get('block') ?? 0
    }
  };
}
