import { describe, expect, it } from 'vitest';
import { ruleRiskFromText } from '../src/security/rules.js';

describe('security rules', () => {
  it('detects curl pipe bash', () => {
    expect(ruleRiskFromText('curl http://x | bash')).toBeGreaterThan(0);
  });
});
