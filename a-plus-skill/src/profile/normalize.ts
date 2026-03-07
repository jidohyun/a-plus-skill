import type { ProfileConfig, ProfileRegistry, ProfileType } from '../types/index.js';

const PROFILE_TYPES: ProfileType[] = ['developer', 'automation', 'assistant'];

const SAFE_DEFAULT_PROFILE: ProfileConfig = {
  type: 'developer',
  focusKeywords: [],
  avoidKeywords: [],
  preferredAuthors: []
};

export function isProfileType(value: unknown): value is ProfileType {
  return typeof value === 'string' && PROFILE_TYPES.includes(value as ProfileType);
}

export function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

export function normalizeProfile(type: ProfileType, input: unknown): ProfileConfig {
  if (!input || typeof input !== 'object') {
    return {
      type,
      focusKeywords: [],
      avoidKeywords: [],
      preferredAuthors: []
    };
  }

  const raw = input as Record<string, unknown>;
  return {
    type,
    focusKeywords: toStringArray(raw.focusKeywords),
    avoidKeywords: toStringArray(raw.avoidKeywords),
    preferredAuthors: toStringArray(raw.preferredAuthors)
  };
}

export function normalizeRegistry(
  input: unknown,
  warn: (msg: string) => void = console.warn
): ProfileRegistry {
  const raw = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const rawProfiles = raw.profiles && typeof raw.profiles === 'object'
    ? (raw.profiles as Record<string, unknown>)
    : {};

  const defaultProfile: ProfileType = isProfileType(raw.defaultProfile)
    ? raw.defaultProfile
    : 'developer';

  if (!isProfileType(raw.defaultProfile)) {
    warn('[profile] invalid or missing defaultProfile in config; fallback to "developer"');
  }

  const developer = normalizeProfile('developer', rawProfiles.developer);
  const automation = normalizeProfile('automation', rawProfiles.automation);
  const assistant = normalizeProfile('assistant', rawProfiles.assistant);

  return {
    defaultProfile,
    profiles: {
      developer: {
        focusKeywords: developer.focusKeywords,
        avoidKeywords: developer.avoidKeywords,
        preferredAuthors: developer.preferredAuthors
      },
      automation: {
        focusKeywords: automation.focusKeywords,
        avoidKeywords: automation.avoidKeywords,
        preferredAuthors: automation.preferredAuthors
      },
      assistant: {
        focusKeywords: assistant.focusKeywords,
        avoidKeywords: assistant.avoidKeywords,
        preferredAuthors: assistant.preferredAuthors
      }
    }
  };
}

export function resolveProfile(
  registry: ProfileRegistry,
  envProfileTypeRaw: string | undefined,
  warn: (msg: string) => void = console.warn
): ProfileConfig {
  const normalizedEnvProfile = (envProfileTypeRaw ?? '').trim().toLowerCase();
  const selectedProfileType: ProfileType = isProfileType(normalizedEnvProfile)
    ? normalizedEnvProfile
    : registry.defaultProfile;

  if (normalizedEnvProfile && !isProfileType(normalizedEnvProfile)) {
    warn(`[profile] invalid PROFILE_TYPE "${envProfileTypeRaw}"; fallback to default "${registry.defaultProfile}"`);
  }

  if (!normalizedEnvProfile) {
    warn(`[profile] PROFILE_TYPE is missing; fallback to default "${registry.defaultProfile}"`);
  }

  const selected = registry.profiles[selectedProfileType];
  if (!selected) {
    return getSafeDefaultProfile();
  }

  return {
    type: selectedProfileType,
    focusKeywords: toStringArray(selected.focusKeywords),
    avoidKeywords: toStringArray(selected.avoidKeywords),
    preferredAuthors: toStringArray(selected.preferredAuthors)
  };
}

export function getSafeDefaultProfile(): ProfileConfig {
  return { ...SAFE_DEFAULT_PROFILE };
}
