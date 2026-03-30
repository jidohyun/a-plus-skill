#!/usr/bin/env node
import { fetchCandidateSkills } from '../src/collector/clawhubClient.ts';
import { loadProfile } from '../src/index.ts';
import { calculateFinalScore, calculateFitScore, calculateStabilityScore, calculateTrendScore } from '../src/recommender/scoring.ts';
import { decide } from '../src/policy/policyEngine.ts';
import { securityScore } from '../src/security/riskScoring.ts';
import { loadPolicyFromEnv } from '../src/install/confirm.ts';

const jsonMode = process.argv.includes('--json');

function summarizeStats(values) {
  if (values.length === 0) {
    return { min: 0, p50: 0, p90: 0, max: 0, avg: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const pick = (p) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
  const avg = sorted.reduce((sum, n) => sum + n, 0) / sorted.length;
  return {
    min: Number(sorted[0].toFixed(1)),
    p50: Number(pick(0.5).toFixed(1)),
    p90: Number(pick(0.9).toFixed(1)),
    max: Number(sorted.at(-1).toFixed(1)),
    avg: Number(avg.toFixed(1))
  };
}

function printStats(label, values) {
  const stats = summarizeStats(values);
  console.log(`${label} min=${stats.min.toFixed(1)} p50=${stats.p50.toFixed(1)} p90=${stats.p90.toFixed(1)} max=${stats.max.toFixed(1)} avg=${stats.avg.toFixed(1)}`);
}

function increment(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

const profile = await loadProfile();
const policy = loadPolicyFromEnv('balanced');
const { skills, meta } = await fetchCandidateSkills();

const fitScores = [];
const trendScores = [];
const stabilityScores = [];
const securityScores = [];
const finalScores = [];
const decisionCounts = new Map();

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

if (jsonMode) {
  console.log(
    JSON.stringify({
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
    })
  );
} else {
  console.log(`scoring_calibration policy=${policy} source=${meta.source} degraded=${meta.degraded} skill_count=${skills.length} sample_quality=${sampleQuality}`);
  if (sampleQuality === 'limited') {
    console.log('note collector fallback or low sample count; use calibration output conservatively');
  }
  printStats('fit', fitScores);
  printStats('trend', trendScores);
  printStats('stability', stabilityScores);
  printStats('security', securityScores);
  printStats('final', finalScores);
  console.log('decision_counts');
  for (const decision of ['recommend', 'caution', 'hold', 'block']) {
    console.log(`- ${decision}: ${decisionCounts.get(decision) ?? 0}`);
  }
}
