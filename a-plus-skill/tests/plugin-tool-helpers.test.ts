import { describe, expect, it } from 'vitest';
import { asToolText, getPluginConfig, makeEnvelope, resolveFormat, summarizeTop } from '../packages/openclaw-plugin-aplus/src/toolHelpers.js';

describe('plugin tool helpers', () => {
  it('wraps json payloads in additive envelope metadata', () => {
    const result = asToolText('aplus_status', { ok: true }, 'summary text', 'json');
    const text = result.content[0]?.text ?? '';
    const parsed = JSON.parse(text);

    expect(parsed.tool).toBe('aplus_status');
    expect(parsed.format).toBe('json');
    expect(typeof parsed.generatedAt).toBe('string');
    expect(parsed.data).toEqual({ ok: true });
  });

  it('returns compact summary text in summary mode', () => {
    const result = asToolText('aplus_status', { ok: true }, 'summary text', 'summary');
    expect(result.content[0]?.text).toBe('summary text');
  });

  it('resolves format safely', () => {
    expect(resolveFormat('summary')).toBe('summary');
    expect(resolveFormat('json')).toBe('json');
    expect(resolveFormat(undefined)).toBe('json');
    expect(resolveFormat('weird')).toBe('json');
  });

  it('extracts plugin config only from object-shaped config', () => {
    expect(getPluginConfig({ config: { format: 'summary', hours: 6 } })).toEqual({ format: 'summary', hours: 6 });
    expect(getPluginConfig({ config: null })).toEqual({});
    expect(getPluginConfig({})).toEqual({});
  });

  it('summarizes top values with fallback', () => {
    expect(summarizeTop(['a', 'b'])).toBe('a, b');
    expect(summarizeTop([])).toBe('none');
    expect(summarizeTop([], 'empty')).toBe('empty');
  });

  it('makeEnvelope returns stable metadata keys', () => {
    const envelope = makeEnvelope('aplus_install_plan', { items: [] });
    expect(envelope.tool).toBe('aplus_install_plan');
    expect(envelope.format).toBe('json');
    expect(envelope.data).toEqual({ items: [] });
    expect(typeof envelope.generatedAt).toBe('string');
  });
});
