import { Type } from '@sinclair/typebox';

export const formatSchema = Type.Optional(Type.Union([Type.Literal('json'), Type.Literal('summary')]));
export const policySchema = Type.Optional(Type.Union([Type.Literal('strict'), Type.Literal('balanced'), Type.Literal('fast')]));
export const profileTypeSchema = Type.Optional(Type.Union([Type.Literal('developer'), Type.Literal('automation'), Type.Literal('assistant')]));

export type ToolFormat = 'json' | 'summary';

export type PluginConfigShape = {
  policy?: 'strict' | 'balanced' | 'fast';
  profileType?: 'developer' | 'automation' | 'assistant';
  hours?: number;
  format?: 'json' | 'summary';
};

export function getPluginConfig(api: { config?: unknown }): PluginConfigShape {
  if (!api || !('config' in api)) return {};
  const raw = api.config;
  if (!raw || typeof raw !== 'object') return {};
  return raw as PluginConfigShape;
}

export function resolveFormat(raw?: string): ToolFormat {
  return raw === 'summary' ? 'summary' : 'json';
}

export function asToolText(payload: unknown, summary: string, format: ToolFormat) {
  return {
    content: [{ type: 'text', text: format === 'summary' ? summary : JSON.stringify(payload, null, 2) }]
  };
}

export function summarizeTop(items: string[], fallback = 'none'): string {
  return items.length > 0 ? items.join(', ') : fallback;
}
