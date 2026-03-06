import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { sendDiscordDm } from './discordDm.js';
import type { CollectorMeta, ReportDeliveryResult } from '../types/index.js';

const MAX_MESSAGE_LENGTH = 1900;
const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 300;
const DELIVERY_LOG_PATH = resolve(process.cwd(), 'data/report-delivery.log');

type SenderFn = (content: string) => Promise<unknown>;
type SleepFn = (ms: number) => Promise<void>;

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

export function splitReportMessage(input: string, maxLen = MAX_MESSAGE_LENGTH): string[] {
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

async function logFailure(message: string): Promise<void> {
  await mkdir(dirname(DELIVERY_LOG_PATH), { recursive: true });
  await appendFile(DELIVERY_LOG_PATH, `${new Date().toISOString()} ${message}\n`, 'utf8');
}

export async function sendWeeklyReport(
  report: string,
  meta?: CollectorMeta,
  deps?: { sender?: SenderFn; sleepFn?: SleepFn }
): Promise<ReportDeliveryResult> {
  const mode = (process.env.REPORT_DELIVERY ?? 'none').trim().toLowerCase();
  if (mode === 'none') {
    return { skipped: true, mode: 'none', chunksAttempted: 0, chunksSent: 0 };
  }

  if (mode !== 'discord-dm') {
    const reason = `unsupported REPORT_DELIVERY: ${mode}`;
    await logFailure(reason);
    return { skipped: true, mode: 'none', reason, chunksAttempted: 0, chunksSent: 0 };
  }

  const sender = deps?.sender ?? ((content: string) => sendDiscordDm(content));
  const sleepImpl = deps?.sleepFn ?? sleep;
  const payload = meta
    ? `${report}\n\n(meta: source=${meta.source}, degraded=${meta.degraded}, fetchedAt=${meta.fetchedAt})`
    : report;
  const chunks = splitReportMessage(payload, MAX_MESSAGE_LENGTH);

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
        const errText = error instanceof Error ? error.message : String(error);
        const logLine = `chunk=${idx + 1}/${chunks.length} attempt=${attempt}/${MAX_ATTEMPTS} error=${errText}`;
        await logFailure(logLine);

        if (attempt < MAX_ATTEMPTS) {
          const backoff = BASE_BACKOFF_MS * 2 ** (attempt - 1);
          await sleepImpl(backoff);
        }
      }
    }

    if (!sent) {
      return {
        skipped: false,
        mode: 'discord-dm',
        success: false,
        chunksAttempted: chunks.length,
        chunksSent,
        reason: `failed at chunk ${idx + 1}`
      };
    }
  }

  return {
    skipped: false,
    mode: 'discord-dm',
    success: true,
    chunksAttempted: chunks.length,
    chunksSent
  };
}
