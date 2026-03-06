import { calculateFinalScore } from './recommender/scoring.js';
import { securityScore } from './security/riskScoring.js';
import { decide } from './policy/policyEngine.js';
import type { SkillMeta } from './types/index.js';

const sample: SkillMeta = {
  slug: 'example/weather',
  name: 'weather',
  downloads: 59600,
  stars: 209,
  securityScanStatus: 'benign'
};

const fit = 78;
const trend = 66;
const stability = 72;
const security = securityScore(sample);
const finalScore = calculateFinalScore({ fit, trend, stability, security });
const decision = decide('balanced', finalScore, security);

console.log({ slug: sample.slug, finalScore: Number(finalScore.toFixed(2)), security, decision });
