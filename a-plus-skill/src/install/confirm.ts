import type { InstallPolicyContext, InstallTopology, Policy } from '../types/index.js';

function envBool(name: string): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'y';
}

export function loadPolicyFromEnv(defaultPolicy: Policy = 'balanced'): Policy {
  const raw = process.env.INSTALL_POLICY?.trim();
  if (raw === 'strict' || raw === 'balanced' || raw === 'fast') return raw;
  return defaultPolicy;
}

export function loadInstallTopologyFromEnv(defaultTopology: InstallTopology = 'single-instance'): InstallTopology {
  const raw = process.env.INSTALL_TOPOLOGY?.trim();
  if (raw === 'local-dev' || raw === 'single-instance' || raw === 'multi-instance') return raw;
  return defaultTopology;
}

export function loadInstallPolicyContextFromEnv(): InstallPolicyContext {
  return {
    confirmed: envBool('INSTALL_CONFIRM'),
    overrideToken: process.env.INSTALL_OVERRIDE_TOKEN,
    strongOverrideToken: process.env.INSTALL_OVERRIDE_STRONG_TOKEN,
    overrideReason: process.env.INSTALL_OVERRIDE_REASON
  };
}
