import { describe, it, expect } from 'vitest';
import {
  calculateFinalScore,
  calculateFitScore,
  calculateStabilityScore,
  calculateTrendScore
} from '../src/recommender/scoring.js';
import type { ProfileConfig, SkillMeta } from '../src/types/index.js';

function makeSkill(overrides: Partial<SkillMeta> = {}): SkillMeta {
  return {
    slug: 'dev-toolkit',
    name: 'Developer Toolkit',
    author: 'openclaw',
    downloads: 12000,
    installsCurrent: 1500,
    stars: 440,
    versions: 10,
    summary: 'TypeScript automation and API workflow helpers',
    securityScanStatus: 'benign',
    securityConfidence: 'high',
    updatedAt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
    ...overrides
  };
}

const developerProfile: ProfileConfig = {
  type: 'developer',
  focusKeywords: ['dev', 'typescript', 'api'],
  avoidKeywords: ['game'],
  preferredAuthors: ['openclaw']
};

const assistantProfile: ProfileConfig = {
  type: 'assistant',
  focusKeywords: ['calendar', 'meeting', 'email'],
  avoidKeywords: ['kernel'],
  preferredAuthors: ['assistant-hub']
};

describe('scoring', () => {
  it('is deterministic for the same input', () => {
    const skill = makeSkill();
    expect(calculateFitScore(skill, developerProfile)).toBe(calculateFitScore(skill, developerProfile));
    expect(calculateTrendScore(skill)).toBe(calculateTrendScore(skill));
    expect(calculateStabilityScore(skill)).toBe(calculateStabilityScore(skill));
  });

  it('keeps trend score monotonic when downloads/stars increase', () => {
    const base = makeSkill({ downloads: 5000, stars: 100 });
    const grown = makeSkill({ downloads: 8000, stars: 150 });

    expect(calculateTrendScore(grown)).toBeGreaterThanOrEqual(calculateTrendScore(base));
  });

  it('changes stability score reasonably with versions and updatedAt', () => {
    const oldAndSparse = makeSkill({
      versions: 2,
      updatedAt: new Date(Date.now() - 700 * 24 * 60 * 60 * 1000).toISOString()
    });
    const frequentAndRecent = makeSkill({
      versions: 25,
      updatedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    });

    expect(calculateStabilityScore(frequentAndRecent)).toBeGreaterThan(calculateStabilityScore(oldAndSparse));
  });

  it('changes fit score by profile', () => {
    const skill = makeSkill();

    expect(calculateFitScore(skill, developerProfile)).toBeGreaterThan(
      calculateFitScore(skill, assistantProfile)
    );
  });

  it('keeps individual and final scores within 0~100', () => {
    const extreme = makeSkill({
      downloads: Number.POSITIVE_INFINITY,
      installsCurrent: Number.POSITIVE_INFINITY,
      stars: Number.POSITIVE_INFINITY,
      versions: Number.POSITIVE_INFINITY,
      updatedAt: 'not-a-date'
    });

    const fit = calculateFitScore(extreme, developerProfile);
    const trend = calculateTrendScore(extreme);
    const stability = calculateStabilityScore(extreme);
    const final = calculateFinalScore({ fit, trend, stability, security: 999 });

    for (const value of [fit, trend, stability, final]) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });

  it('calculates weighted final score', () => {
    const result = calculateFinalScore({ fit: 80, trend: 60, stability: 70, security: 90 });
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThanOrEqual(100);
  });
});
