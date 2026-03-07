import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const GENESIS_PREV_HASH = 'genesis';

type InstallAuditEvent = {
  schemaVersion: number;
  eventId: string;
  ts: string;
  slug: string;
  policy: string;
  topology: string;
  originalDecision: string;
  effectiveDecision: string;
  action: string;
  canInstall: boolean;
  status: string;
  errorCode?: string;
  timeoutMs?: number;
  elapsedMs?: number;
  degraded: boolean;
  notes: string[];
  prevHash: string;
  hash: string;
};

type VerifyResult = {
  ok: boolean;
  line: number;
  reason: string;
};

function canonicalStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalStringify(item)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalStringify(record[key])}`).join(',')}}`;
  }

  return JSON.stringify(value);
}

function computeHash(event: InstallAuditEvent): string {
  const { hash: _ignored, ...payload } = event;
  return createHash('sha256').update(canonicalStringify(payload), 'utf8').digest('hex');
}

function fail(line: number, reason: string): VerifyResult {
  return { ok: false, line, reason };
}

function verifyEvents(lines: string[]): VerifyResult {
  let expectedPrevHash = GENESIS_PREV_HASH;
  let verifiedCount = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i]?.trim();
    if (!raw) {
      continue;
    }

    const lineNumber = i + 1;
    let event: InstallAuditEvent;

    try {
      event = JSON.parse(raw) as InstallAuditEvent;
    } catch {
      return fail(lineNumber, 'malformed JSON');
    }

    if (!event || typeof event !== 'object') {
      return fail(lineNumber, 'event is not an object');
    }

    if (typeof event.eventId !== 'string' || event.eventId.length === 0) {
      return fail(lineNumber, 'missing/invalid eventId');
    }
    if (typeof event.prevHash !== 'string' || event.prevHash.length === 0) {
      return fail(lineNumber, 'missing/invalid prevHash');
    }
    if (typeof event.hash !== 'string' || event.hash.length === 0) {
      return fail(lineNumber, 'missing/invalid hash');
    }
    if (typeof event.schemaVersion !== 'number') {
      return fail(lineNumber, 'missing/invalid schemaVersion');
    }

    if (event.prevHash !== expectedPrevHash) {
      return fail(
        lineNumber,
        `prevHash mismatch (expected=${expectedPrevHash}, actual=${event.prevHash})`
      );
    }

    const recomputed = computeHash(event);
    if (recomputed !== event.hash) {
      return fail(lineNumber, `hash mismatch (expected=${recomputed}, actual=${event.hash})`);
    }

    expectedPrevHash = event.hash;
    verifiedCount += 1;
  }

  return {
    ok: true,
    line: 0,
    reason: `OK verified=${verifiedCount} lastHash=${expectedPrevHash}`
  };
}

function getAuditPath(): string {
  const rawPath = process.env.INSTALL_AUDIT_LOG_PATH?.trim();
  if (rawPath) {
    return resolve(process.cwd(), rawPath);
  }
  return resolve(process.cwd(), 'data', 'install-events.jsonl');
}

function main(): void {
  const file = getAuditPath();

  let content = '';
  try {
    content = readFileSync(file, 'utf8');
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`ERROR line=0 reason=failed to read file (${reason}) path=${file}`);
    process.exitCode = 1;
    return;
  }

  const result = verifyEvents(content.split('\n'));
  if (!result.ok) {
    console.error(`ERROR line=${result.line} reason=${result.reason} path=${file}`);
    process.exitCode = 1;
    return;
  }

  console.log(`${result.reason} path=${file}`);
}

main();
