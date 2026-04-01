import type { Policy, ProfileType } from '../../types/index.js';

export type RuntimeConfigInput = {
  policy?: string;
  profileType?: string;
  hours?: number;
  format?: string;
};

export type RuntimeConfigPlugin = {
  policy?: string;
  profileType?: string;
  hours?: number;
  format?: string;
};

export type RuntimeConfigEnv = {
  INSTALL_POLICY?: string;
  PROFILE_TYPE?: string;
};

export type RuntimeConfigDefaults = {
  policy?: Policy;
  profileType?: ProfileType;
  hours?: number;
  format?: 'json' | 'summary';
};

export type ResolvedRuntimeConfig = {
  policy: Policy;
  profileType: ProfileType;
  hours: number;
  format: 'json' | 'summary';
};

function resolvePolicy(...values: Array<string | undefined>): Policy {
  for (const value of values) {
    if (value === 'strict' || value === 'balanced' || value === 'fast') return value;
  }
  return 'balanced';
}

function resolveProfileType(...values: Array<string | undefined>): ProfileType {
  for (const value of values) {
    if (value === 'developer' || value === 'automation' || value === 'assistant') return value;
  }
  return 'developer';
}

function resolveHours(...values: Array<number | undefined>): number {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 1) return Math.max(1, value);
  }
  return 24;
}

function resolveFormat(...values: Array<string | undefined>): 'json' | 'summary' {
  for (const value of values) {
    if (value === 'json' || value === 'summary') return value;
  }
  return 'json';
}

export function resolveRuntimeConfig(args: {
  toolInput?: RuntimeConfigInput;
  pluginConfig?: RuntimeConfigPlugin;
  env?: RuntimeConfigEnv;
  defaults?: RuntimeConfigDefaults;
} = {}): ResolvedRuntimeConfig {
  const toolInput = args.toolInput ?? {};
  const pluginConfig = args.pluginConfig ?? {};
  const env = args.env ?? process.env;
  const defaults = args.defaults ?? {};

  return {
    policy: resolvePolicy(toolInput.policy, pluginConfig.policy, env.INSTALL_POLICY, defaults.policy),
    profileType: resolveProfileType(toolInput.profileType, pluginConfig.profileType, env.PROFILE_TYPE, defaults.profileType),
    hours: resolveHours(toolInput.hours, pluginConfig.hours, defaults.hours),
    format: resolveFormat(toolInput.format, pluginConfig.format, defaults.format)
  };
}
