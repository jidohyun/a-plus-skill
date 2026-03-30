import { describe, it, expect } from 'vitest';
import {
  calculateFinalScore,
  calculateFitScore,
  calculateStabilityScore,
  calculateTrendScore
} from '../src/recommender/scoring.js';
import type { ProfileConfig, SkillMeta } from '../src/types/index.js';
import { normalizeProfile } from '../src/profile/normalize.js';

const FIXED_NOW_MS = Date.parse('2026-01-01T00:00:00.000Z');

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
    updatedAt: new Date(FIXED_NOW_MS - 14 * 24 * 60 * 60 * 1000).toISOString(),
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
    expect(calculateStabilityScore(skill, FIXED_NOW_MS)).toBe(calculateStabilityScore(skill, FIXED_NOW_MS));
  });

  it('keeps trend score monotonic when downloads/stars increase', () => {
    const base = makeSkill({ downloads: 5000, stars: 100 });
    const grown = makeSkill({ downloads: 8000, stars: 150 });

    expect(calculateTrendScore(grown)).toBeGreaterThanOrEqual(calculateTrendScore(base));
  });

  it('gives active installs more influence than pure download bulk when popularity is stale', () => {
    const bulky = makeSkill({ downloads: 100000, installsCurrent: 50, stars: 40 });
    const active = makeSkill({ downloads: 3000, installsCurrent: 1200, stars: 120 });

    expect(calculateTrendScore(active)).toBeGreaterThan(calculateTrendScore(bulky));
  });

  it('changes stability score reasonably with versions and updatedAt', () => {
    const oldAndSparse = makeSkill({
      versions: 2,
      updatedAt: new Date(FIXED_NOW_MS - 700 * 24 * 60 * 60 * 1000).toISOString()
    });
    const frequentAndRecent = makeSkill({
      versions: 25,
      updatedAt: new Date(FIXED_NOW_MS - 7 * 24 * 60 * 60 * 1000).toISOString()
    });

    expect(calculateStabilityScore(frequentAndRecent, FIXED_NOW_MS)).toBeGreaterThan(
      calculateStabilityScore(oldAndSparse, FIXED_NOW_MS)
    );
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
    const stability = calculateStabilityScore(extreme, FIXED_NOW_MS);
    const final = calculateFinalScore({ fit, trend, stability, security: 999 });

    for (const value of [fit, trend, stability, final]) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });

  it('calculates weighted final score', () => {
    const result = calculateFinalScore({ fit: 80, trend: 60, stability: 70, security: 90 });
    expect(result).toBeCloseTo(77.5, 6);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThanOrEqual(100);
  });

  it('slightly favors fit/stability over raw trend/security when scores are close', () => {
    const activeFit = calculateFinalScore({ fit: 82, trend: 63, stability: 74, security: 68 });
    const hypeOnly = calculateFinalScore({ fit: 68, trend: 80, stability: 55, security: 72 });
    expect(activeFit).toBeGreaterThan(hypeOnly);
  });

  it('applies rounding to 6 decimals for stability score', () => {
    const skill = makeSkill({
      versions: 7,
      updatedAt: new Date(FIXED_NOW_MS - 123 * 24 * 60 * 60 * 1000).toISOString()
    });

    const score = calculateStabilityScore(skill, FIXED_NOW_MS);
    expect(score).toBeCloseTo(Number(score.toFixed(6)), 6);
  });

  it('normalizes polluted profile arrays without crashing scoring', () => {
    const polluted = normalizeProfile('developer', {
      focusKeywords: ['typescript', 123, { bad: true }, 'api'],
      avoidKeywords: ['game', false, null],
      preferredAuthors: ['openclaw', 999]
    });

    const skill = makeSkill();
    const fit = calculateFitScore(skill, polluted);

    expect(fit).toBeGreaterThanOrEqual(0);
    expect(fit).toBeLessThanOrEqual(100);
    expect(polluted.focusKeywords).toEqual(['typescript', 'api']);
    expect(polluted.avoidKeywords).toEqual(['game']);
    expect(polluted.preferredAuthors).toEqual(['openclaw']);
  });
});
