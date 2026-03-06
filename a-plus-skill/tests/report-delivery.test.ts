import { afterEach, describe, expect, it, vi } from 'vitest';
import { DiscordDmError } from '../src/delivery/discordDm.js';
import { TelegramSendError } from '../src/delivery/telegram.js';
import { sendWeeklyReport } from '../src/delivery/reportSender.js';

describe('report delivery', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('splits long report and sends all chunks for discord-dm', async () => {
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

  it('splits long report and sends all chunks for telegram', async () => {
    vi.stubEnv('REPORT_DELIVERY', 'telegram');

    const sent: string[] = [];
    const longText = `header\n${'A'.repeat(8001)}\nfooter`;

    const result = await sendWeeklyReport(longText, undefined, {
      sender: async (chunk) => {
        sent.push(chunk);
      },
      sleepFn: async () => {}
    });

    expect(result.success).toBe(true);
    expect(result.mode).toBe('telegram');
    expect(sent.length).toBeGreaterThan(1);
    expect(sent.every((s) => s.length <= 4000)).toBe(true);
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

  it('uses retry_after on 429 errors (discord)', async () => {
    vi.stubEnv('REPORT_DELIVERY', 'discord-dm');

    const sleeps: number[] = [];
    let attempts = 0;
    const result = await sendWeeklyReport('short-report', undefined, {
      sender: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new DiscordDmError('SEND_DM_FAILED', 'rate limited', 429, 1500);
        }
      },
      sleepFn: async (ms) => {
        sleeps.push(ms);
      }
    });

    expect(result.success).toBe(true);
    expect(sleeps[0]).toBe(1500);
  });

  it('uses retry_after on 429 errors (telegram)', async () => {
    vi.stubEnv('REPORT_DELIVERY', 'telegram');

    const sleeps: number[] = [];
    let attempts = 0;
    const result = await sendWeeklyReport('short-report', undefined, {
      sender: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new TelegramSendError('SEND_MESSAGE_FAILED', 'rate limited', 429, 2500);
        }
      },
      sleepFn: async (ms) => {
        sleeps.push(ms);
      }
    });

    expect(result.success).toBe(true);
    expect(sleeps[0]).toBe(2500);
  });

  it('caps overly large retry_after on 429 errors', async () => {
    vi.stubEnv('REPORT_DELIVERY', 'discord-dm');

    const sleeps: number[] = [];
    let attempts = 0;
    const result = await sendWeeklyReport('short-report', undefined, {
      sender: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new DiscordDmError('SEND_DM_FAILED', 'rate limited', 429, 9999999);
        }
      },
      sleepFn: async (ms) => {
        sleeps.push(ms);
      }
    });

    expect(result.success).toBe(true);
    expect(sleeps[0]).toBe(60000);
  });

  it('does not retry non-retryable 401 errors', async () => {
    vi.stubEnv('REPORT_DELIVERY', 'discord-dm');

    let attempts = 0;
    const result = await sendWeeklyReport('short-report', undefined, {
      sender: async () => {
        attempts += 1;
        throw new DiscordDmError('SEND_DM_FAILED', 'unauthorized', 401);
      },
      sleepFn: async () => {}
    });

    expect(attempts).toBe(1);
    expect(result.success).toBe(false);
  });

  it('does not retry missing config errors (telegram)', async () => {
    vi.stubEnv('REPORT_DELIVERY', 'telegram');

    let attempts = 0;
    const result = await sendWeeklyReport('short-report', undefined, {
      sender: async () => {
        attempts += 1;
        throw new TelegramSendError('MISSING_CONFIG', 'missing TELEGRAM_BOT_TOKEN');
      },
      sleepFn: async () => {}
    });

    expect(attempts).toBe(1);
    expect(result.success).toBe(false);
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

  it('skips with reason when REPORT_DELIVERY mode is unsupported', async () => {
    vi.stubEnv('REPORT_DELIVERY', 'smtp');

    const result = await sendWeeklyReport('report', undefined, {
      sender: async () => {
        throw new Error('should not run');
      },
      sleepFn: async () => {}
    });

    expect(result.skipped).toBe(true);
    expect(result.mode).toBe('none');
    expect(result.reason).toContain('unsupported');
  });
});
