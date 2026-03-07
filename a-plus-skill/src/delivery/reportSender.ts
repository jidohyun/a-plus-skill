import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createDiscordDmSender, DiscordDmError } from './discordDm.js';
import { createTelegramSender, TelegramSendError } from './telegram.js';
import type { CollectorMeta, ReportDeliveryMode, ReportDeliveryResult } from '../types/index.js';

const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 300;
const MAX_RETRY_AFTER_MS = 60_000;
const DELIVERY_LOG_PATH = resolve(process.cwd(), 'data/report-delivery.log');
const MAX_MESSAGE_LENGTH: Record<Exclude<ReportDeliveryMode, 'none'>, number> = {
  'discord-dm': 1900,
  telegram: 4000
};

type SenderFn = (content: string) => Promise<unknown>;
type SleepFn = (ms: number) => Promise<void>;

type ErrorInfo = {
  code: string;
  status?: number;
  retryAfterMs?: number;
};

function sanitizeCode(code: string): string {
  return code.replace(/[^A-Z0-9_\-]/gi, '_').slice(0, 64) || 'UNKNOWN';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

export function splitReportMessage(input: string, maxLen: number): string[] {
  if (input.length <= maxLen) return [input];

  const chunks: string[] = [];
  const lines = input.split('\n');
  let current = '';

  const pushCurrent = () => {
    if (current) chunks.push(current);
    current = '';
  };

  for (const line of lines) {
    if (!line && current.length + 1 <= maxLen) {
      current += current ? '\n' : '';
      continue;
    }

    if (line.length > maxLen) {
      pushCurrent();
      for (let i = 0; i < line.length; i += maxLen) {
        chunks.push(line.slice(i, i + maxLen));
      }
      continue;
    }

    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length <= maxLen) {
      current = candidate;
    } else {
      pushCurrent();
      current = line;
    }
  }

  pushCurrent();
  return chunks;
}

function sanitizeError(error: unknown): ErrorInfo {
  if (error instanceof DiscordDmError || error instanceof TelegramSendError) {
    return {
      code: error.code,
      status: error.status,
      retryAfterMs: error.retryAfterMs
    };
  }

  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
  ) {
    const status = 'status' in error && typeof (error as { status?: unknown }).status === 'number'
      ? (error as { status?: number }).status
      : undefined;
    const retryAfterMs =
      'retryAfterMs' in error && typeof (error as { retryAfterMs?: unknown }).retryAfterMs === 'number'
        ? (error as { retryAfterMs?: number }).retryAfterMs
        : undefined;

    return { code: (error as { code: string }).code, status, retryAfterMs };
  }

  if (error instanceof Error) {
    return { code: 'GENERIC_ERROR' };
  }

  return { code: 'UNKNOWN_ERROR' };
}

async function logFailure(message: string): Promise<void> {
  try {
    await mkdir(dirname(DELIVERY_LOG_PATH), { recursive: true });
    await appendFile(DELIVERY_LOG_PATH, `${new Date().toISOString()} ${message}\n`, 'utf8');
  } catch {
    // do not fail delivery flow due to logging failure
  }
}

function isRetryable(info: ErrorInfo): boolean {
  if (info.code === 'MISSING_CONFIG') return false;
  if (typeof info.status === 'number' && info.status >= 400 && info.status < 500 && info.status !== 429) return false;
  if (info.status === 429) return true;
  if (typeof info.status === 'number') return info.status >= 500;
  return true; // unknown/network-like errors
}

function computeBackoffMs(info: ErrorInfo, attempt: number): number {
  if (info.status === 429 && info.retryAfterMs && Number.isFinite(info.retryAfterMs)) {
    const clamped = Math.min(Math.max(info.retryAfterMs, BASE_BACKOFF_MS), MAX_RETRY_AFTER_MS);
    return clamped;
  }
  return BASE_BACKOFF_MS * 2 ** (attempt - 1);
}

function resolveMode(raw: string): ReportDeliveryMode | 'unsupported' {
  if (raw === 'none') return 'none';
  if (raw === 'discord-dm') return 'discord-dm';
  if (raw === 'telegram') return 'telegram';
  return 'unsupported';
}

function sanitizeMode(raw: string): string {
  return raw.replace(/[^a-z0-9_-]/gi, '_').slice(0, 32) || 'unknown';
}

function enforceModeLock(resolved: ReportDeliveryMode | 'unsupported', rawMode: string): ReportDeliveryMode | 'unsupported' {
  const locked = (process.env.REPORT_DELIVERY_LOCKED ?? '').trim().toLowerCase();
  if (!locked) return resolved;

  const lockedMode = resolveMode(locked);
  if (lockedMode === 'unsupported') return 'unsupported';

  if (rawMode !== lockedMode) {
    return 'unsupported';
  }

  return resolved;
}

function createSender(mode: Exclude<ReportDeliveryMode, 'none'>, deps?: { sender?: SenderFn }): SenderFn {
  if (deps?.sender) return deps.sender;
  if (mode === 'discord-dm') return createDiscordDmSender();
  return createTelegramSender();
}

export async function sendWeeklyReport(
  report: string,
  meta?: CollectorMeta,
  deps?: { sender?: SenderFn; sleepFn?: SleepFn }
): Promise<ReportDeliveryResult> {
  const rawMode = (process.env.REPORT_DELIVERY ?? 'none').trim().toLowerCase();
  const mode = enforceModeLock(resolveMode(rawMode), rawMode);

  if (mode === 'none') {
    return { skipped: true, mode: 'none', chunksAttempted: 0, chunksSent: 0 };
  }

  if (mode === 'unsupported') {
    const reason = 'unsupported REPORT_DELIVERY mode';
    await logFailure(`event=unsupported_mode mode=${sanitizeMode(rawMode)}`);
    return { skipped: true, mode: 'none', reason, chunksAttempted: 0, chunksSent: 0 };
  }

  const sender = createSender(mode, deps);
  const sleepImpl = deps?.sleepFn ?? sleep;
  const payload = meta
    ? `${report}\n\n(meta: source=${meta.source}, degraded=${meta.degraded}, fetchedAt=${meta.fetchedAt})`
    : report;
  const chunks = splitReportMessage(payload, MAX_MESSAGE_LENGTH[mode]);

  let chunksSent = 0;

  for (let idx = 0; idx < chunks.length; idx += 1) {
    const chunk = chunks[idx]!;
    let sent = false;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        await sender(chunk);
        chunksSent += 1;
        sent = true;
        break;
      } catch (error) {
        const info = sanitizeError(error);
        const safeCode = sanitizeCode(info.code);
        await logFailure(
          `event=delivery_failed mode=${mode} chunk=${idx + 1}/${chunks.length} attempt=${attempt}/${MAX_ATTEMPTS} code=${safeCode}${
            info.status ? ` status=${info.status}` : ''
          }${info.retryAfterMs ? ` retry_after_ms=${info.retryAfterMs}` : ''}`
        );

        if (attempt < MAX_ATTEMPTS && isRetryable(info)) {
          const backoff = computeBackoffMs(info, attempt);
          await sleepImpl(backoff);
          continue;
        }

        break;
      }
    }

    if (!sent) {
      return {
        skipped: false,
        mode,
        success: false,
        chunksAttempted: chunks.length,
        chunksSent,
        reason: `failed at chunk ${idx + 1}`
      };
    }
  }

  return {
    skipped: false,
    mode,
    success: true,
    chunksAttempted: chunks.length,
    chunksSent
  };
}
