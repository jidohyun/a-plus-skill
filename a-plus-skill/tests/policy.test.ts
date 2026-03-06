import { describe, expect, it } from 'vitest';
import { decide } from '../src/policy/policyEngine.js';

describe('policy', () => {
  it('blocks low security', () => {
    expect(decide('balanced', 90, 30)).toBe('block');
  });
});
