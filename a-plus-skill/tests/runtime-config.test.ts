import { describe, expect, it } from 'vitest';
import { resolveRuntimeConfig } from '../src/application/config/resolveRuntimeConfig.js';

describe('runtime config resolver', () => {
  it('uses precedence tool input > plugin config > env > defaults', () => {
    const resolved = resolveRuntimeConfig({
      toolInput: { policy: 'strict', profileType: 'assistant', hours: 3, format: 'summary' },
      pluginConfig: { policy: 'fast', profileType: 'automation', hours: 12, format: 'json' },
      env: { INSTALL_POLICY: 'balanced', PROFILE_TYPE: 'developer' },
      defaults: { policy: 'balanced', profileType: 'developer', hours: 24, format: 'json' }
    });

    expect(resolved).toEqual({
      policy: 'strict',
      profileType: 'assistant',
      hours: 3,
      format: 'summary'
    });
  });

  it('falls back through plugin config, env, and defaults', () => {
    const resolved = resolveRuntimeConfig({
      toolInput: {},
      pluginConfig: { hours: 6 },
      env: { INSTALL_POLICY: 'fast', PROFILE_TYPE: 'automation' },
      defaults: { format: 'summary' }
    });

    expect(resolved).toEqual({
      policy: 'fast',
      profileType: 'automation',
      hours: 6,
      format: 'summary'
    });
  });
});
