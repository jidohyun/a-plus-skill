import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendWeeklyReport } from '../src/delivery/reportSender.js';

describe('report delivery', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('splits long report and sends all chunks', async () => {
    vi.stubEnv('REPORT_DELIVERY', 'discord-dm');

    const sent: string[] = [];
    const longText = `header\n${'A'.repeat(3800)}\nfooter`;

    const result = await sendWeeklyReport(longText, undefined, {
      sender: async (chunk) => {
        sent.push(chunk);
      },
      sleepFn: async () => {}
    });

    expect(result.success).toBe(true);
    expect(result.skipped).toBe(false);
    expect(sent.length).toBeGreaterThan(1);
    expect(sent.every((s) => s.length <= 1900)).toBe(true);
  });

  it('retries and succeeds before max attempts', async () => {
    vi.stubEnv('REPORT_DELIVERY', 'discord-dm');

    let attempts = 0;
    const result = await sendWeeklyReport('short-report', undefined, {
      sender: async () => {
        attempts += 1;
        if (attempts < 3) throw new Error('temporary failure');
      },
      sleepFn: async () => {}
    });

    expect(attempts).toBe(3);
    expect(result.success).toBe(true);
    expect(result.chunksSent).toBe(1);
  });

  it('fails after max retries', async () => {
    vi.stubEnv('REPORT_DELIVERY', 'discord-dm');

    let attempts = 0;
    const result = await sendWeeklyReport('short-report', undefined, {
      sender: async () => {
        attempts += 1;
        throw new Error('permanent failure');
      },
      sleepFn: async () => {}
    });

    expect(attempts).toBe(3);
    expect(result.success).toBe(false);
    expect(result.reason).toContain('failed at chunk');
  });

  it('skips delivery when REPORT_DELIVERY=none', async () => {
    vi.stubEnv('REPORT_DELIVERY', 'none');

    let called = 0;
    const result = await sendWeeklyReport('report', undefined, {
      sender: async () => {
        called += 1;
      },
      sleepFn: async () => {}
    });

    expect(result.skipped).toBe(true);
    expect(result.mode).toBe('none');
    expect(called).toBe(0);
  });
});
