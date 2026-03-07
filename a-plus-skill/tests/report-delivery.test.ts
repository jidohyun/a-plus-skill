import { readFile, rm, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DiscordDmError } from '../src/delivery/discordDm.js';
import { TelegramSendError } from '../src/delivery/telegram.js';
import { sendWeeklyReport } from '../src/delivery/reportSender.js';

const deliveryLogPath = resolve(process.cwd(), 'data/report-delivery.log');
const deliveryLogRotatedPath = `${deliveryLogPath}.1`;

describe('report delivery', () => {
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(deliveryLogPath, { force: true });
    await rm(deliveryLogRotatedPath, { force: true });
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

  it('retries network errors and succeeds before max attempts', async () => {
    vi.stubEnv('REPORT_DELIVERY', 'discord-dm');

    let attempts = 0;
    const result = await sendWeeklyReport('short-report', undefined, {
      sender: async () => {
        attempts += 1;
        if (attempts < 3) throw new TypeError('temporary network failure');
      },
      sleepFn: async () => {}
    });

    expect(attempts).toBe(3);
    expect(result.success).toBe(true);
    expect(result.chunksSent).toBe(1);
  });

  it('fails after max retries for persistent network errors', async () => {
    vi.stubEnv('REPORT_DELIVERY', 'discord-dm');

    let attempts = 0;
    const result = await sendWeeklyReport('short-report', undefined, {
      sender: async () => {
        attempts += 1;
        throw new TypeError('permanent network failure');
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

  it('does not retry generic non-network errors', async () => {
    vi.stubEnv('REPORT_DELIVERY', 'discord-dm');

    let attempts = 0;
    const result = await sendWeeklyReport('short-report', undefined, {
      sender: async () => {
        attempts += 1;
        throw new Error('logic failure');
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

  it('skips with unsupported reason when REPORT_DELIVERY mode is unsupported', async () => {
    vi.stubEnv('REPORT_DELIVERY', 'smtp');

    const result = await sendWeeklyReport('report', undefined, {
      sender: async () => {
        throw new Error('should not run');
      },
      sleepFn: async () => {}
    });

    expect(result.skipped).toBe(true);
    expect(result.mode).toBe('none');
    expect(result.reason).toBe('unsupported REPORT_DELIVERY mode');
  });

  it('uses lock_mismatch reason when REPORT_DELIVERY does not match REPORT_DELIVERY_LOCKED', async () => {
    vi.stubEnv('REPORT_DELIVERY', 'telegram');
    vi.stubEnv('REPORT_DELIVERY_LOCKED', 'discord-dm');

    let called = 0;
    const result = await sendWeeklyReport('report', undefined, {
      sender: async () => {
        called += 1;
      },
      sleepFn: async () => {}
    });

    const current = await readFile(deliveryLogPath, 'utf8');

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('lock_mismatch');
    expect(current).toContain('event=lock_mismatch');
    expect(current).toContain('expected=discord-dm');
    expect(current).toContain('actual=telegram');
    expect(called).toBe(0);
  });

  it('keeps unsupported mode reason when raw mode is unsupported even with lock configured', async () => {
    vi.stubEnv('REPORT_DELIVERY', 'smtp');
    vi.stubEnv('REPORT_DELIVERY_LOCKED', 'discord-dm');

    const result = await sendWeeklyReport('report', undefined, {
      sender: async () => {
        throw new Error('should not run');
      },
      sleepFn: async () => {}
    });

    const current = await readFile(deliveryLogPath, 'utf8');

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('unsupported REPORT_DELIVERY mode');
    expect(current).toContain('event=unsupported_mode');
    expect(current).not.toContain('event=lock_mismatch');
  });

  it('does not inline-rotate delivery failure log by default (append-only)', async () => {
    vi.stubEnv('REPORT_DELIVERY', 'smtp');
    vi.stubEnv('REPORT_DELIVERY_LOG_MAX_BYTES', '64');

    await writeFile(deliveryLogPath, 'x'.repeat(64), 'utf8');

    await sendWeeklyReport('report', undefined, {
      sender: async () => {
        throw new Error('should not run');
      },
      sleepFn: async () => {}
    });

    const current = await readFile(deliveryLogPath, 'utf8');

    await expect(stat(deliveryLogRotatedPath)).rejects.toThrow();
    expect(current.startsWith('x'.repeat(64))).toBe(true);
    expect(current).toContain('event=unsupported_mode');
  });

  it('rotates delivery failure log when inline rotate flag is enabled', async () => {
    vi.stubEnv('REPORT_DELIVERY', 'smtp');
    vi.stubEnv('REPORT_DELIVERY_LOG_MAX_BYTES', '64');
    vi.stubEnv('REPORT_DELIVERY_INLINE_ROTATE', 'true');

    await writeFile(deliveryLogPath, 'x'.repeat(64), 'utf8');

    await sendWeeklyReport('report', undefined, {
      sender: async () => {
        throw new Error('should not run');
      },
      sleepFn: async () => {}
    });

    const rotated = await readFile(deliveryLogRotatedPath, 'utf8');
    const current = await readFile(deliveryLogPath, 'utf8');

    expect(rotated).toBe('x'.repeat(64));
    expect(current).toContain('event=unsupported_mode');
    expect(current.length).toBeGreaterThan(0);
  });
});
