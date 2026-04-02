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

export type ToolEnvelope<T> = {
  tool: string;
  format: 'json';
  generatedAt: string;
  data: T;
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

export function makeEnvelope<T>(tool: string, data: T): ToolEnvelope<T> {
  return {
    tool,
    format: 'json',
    generatedAt: new Date().toISOString(),
    data
  };
}

export function asToolText<T>(tool: string, payload: T, summary: string, format: ToolFormat) {
  const value = format === 'summary' ? summary : JSON.stringify(makeEnvelope(tool, payload), null, 2);
  return {
    content: [{ type: 'text', text: value }]
  };
}

export function summarizeTop(items: string[], fallback = 'none'): string {
  return items.length > 0 ? items.join(', ') : fallback;
}
