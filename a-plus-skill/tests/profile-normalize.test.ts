import { describe, expect, it, vi } from 'vitest';
import { getSafeDefaultProfile, normalizeRegistry, resolveProfile } from '../src/profile/normalize.js';

describe('profile normalization', () => {
  it('falls back to default profile when PROFILE_TYPE is invalid', () => {
    const warn = vi.fn();
    const registry = normalizeRegistry(
      {
        defaultProfile: 'developer',
        profiles: {
          developer: {
            focusKeywords: ['dev'],
            avoidKeywords: ['game'],
            preferredAuthors: ['openclaw']
          }
        }
      },
      warn
    );

    const profile = resolveProfile(registry, 'not-a-profile', warn);

    expect(profile.type).toBe('developer');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('invalid PROFILE_TYPE'));
  });

  it('sanitizes malformed registry shape and arrays safely', () => {
    const warn = vi.fn();
    const registry = normalizeRegistry(
      {
        defaultProfile: 'oops',
        profiles: {
          developer: {
            focusKeywords: ['api', 1, { no: true }],
            avoidKeywords: [false, 'finance'],
            preferredAuthors: ['core-team', null]
          }
        }
      },
      warn
    );

    expect(registry.defaultProfile).toBe('developer');
    expect(registry.profiles.developer.focusKeywords).toEqual(['api']);
    expect(registry.profiles.developer.avoidKeywords).toEqual(['finance']);
    expect(registry.profiles.developer.preferredAuthors).toEqual(['core-team']);
    expect(registry.profiles.automation.focusKeywords).toEqual([]);
    expect(registry.profiles.assistant.preferredAuthors).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('invalid or missing defaultProfile'));
  });

  it('returns isolated arrays in safe default profile', () => {
    const first = getSafeDefaultProfile();
    const original = [...first.focusKeywords];
    first.focusKeywords.push('mutated');

    const second = getSafeDefaultProfile();
    expect(second.focusKeywords).toEqual(original);
    expect(second.focusKeywords).toContain('typescript');
    expect(second.avoidKeywords).toContain('social');
    expect(second.preferredAuthors).toContain('openclaw');
  });
});
