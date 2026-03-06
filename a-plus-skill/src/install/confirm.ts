import type { InstallPolicyContext, Policy } from '../types/index.js';

function envBool(name: string): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'y';
}

export function loadPolicyFromEnv(defaultPolicy: Policy = 'balanced'): Policy {
  const raw = process.env.INSTALL_POLICY?.trim();
  if (raw === 'strict' || raw === 'balanced' || raw === 'fast') return raw;
  return defaultPolicy;
}

export function loadInstallPolicyContextFromEnv(): InstallPolicyContext {
  return {
    confirmed: envBool('INSTALL_CONFIRM'),
    overrideToken: process.env.INSTALL_OVERRIDE_TOKEN,
    strongOverrideToken: process.env.INSTALL_OVERRIDE_STRONG_TOKEN,
    overrideReason: process.env.INSTALL_OVERRIDE_REASON
  };
}
