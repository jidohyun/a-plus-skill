import { describe, it, expect } from 'vitest';
import { calculateFinalScore } from '../src/recommender/scoring.js';

describe('scoring', () => {
  it('calculates weighted score', () => {
    const result = calculateFinalScore({ fit: 80, trend: 60, stability: 70, security: 90 });
    expect(result).toBeGreaterThan(0);
  });
});
