#!/usr/bin/env node
import { fetchCandidateSkills } from '../src/collector/clawhubClient.ts';
import { loadProfile } from '../src/index.ts';
import { calculateFinalScore, calculateFitScore, calculateStabilityScore, calculateTrendScore } from '../src/recommender/scoring.ts';
import { decide } from '../src/policy/policyEngine.ts';
import { securityScore } from '../src/security/riskScoring.ts';
import { loadPolicyFromEnv } from '../src/install/confirm.ts';

function printStats(label, values) {
  if (values.length === 0) {
    console.log(`${label} min=0 p50=0 p90=0 max=0 avg=0`);
    return;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const pick = (p) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
  const avg = sorted.reduce((sum, n) => sum + n, 0) / sorted.length;
  console.log(
    `${label} min=${sorted[0].toFixed(1)} p50=${pick(0.5).toFixed(1)} p90=${pick(0.9).toFixed(1)} max=${sorted.at(-1).toFixed(1)} avg=${avg.toFixed(1)}`
  );
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

console.log(`scoring_calibration policy=${policy} source=${meta.source} degraded=${meta.degraded} skill_count=${skills.length}`);
printStats('fit', fitScores);
printStats('trend', trendScores);
printStats('stability', stabilityScores);
printStats('security', securityScores);
printStats('final', finalScores);
console.log('decision_counts');
for (const decision of ['recommend', 'caution', 'hold', 'block']) {
  console.log(`- ${decision}: ${decisionCounts.get(decision) ?? 0}`);
}
