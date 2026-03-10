import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { InstallAuditEvent } from '../types/index.js';

export const INSTALL_AUDIT_SCHEMA_VERSION = 1;
export const INSTALL_AUDIT_GENESIS_PREV_HASH = 'genesis';

export type InstallAuditVerifyResult = {
  ok: boolean;
  line: number;
  reason: string;
  verifiedCount: number;
  lastHash: string;
};

function fail(line: number, reason: string): InstallAuditVerifyResult {
  return {
    ok: false,
    line,
    reason,
    verifiedCount: 0,
    lastHash: INSTALL_AUDIT_GENESIS_PREV_HASH
  };
}

export function canonicalStringify(value: unknown): string {
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

export function computeInstallAuditHash(event: Omit<InstallAuditEvent, 'hash'>): string {
  return createHash('sha256').update(canonicalStringify(event), 'utf8').digest('hex');
}

export function getInstallAuditPath(cwd = process.cwd(), rawPath = process.env.INSTALL_AUDIT_LOG_PATH): string {
  const customPath = rawPath?.trim();
  if (customPath) {
    return resolve(cwd, customPath);
  }
  return resolve(cwd, 'data', 'install-events.jsonl');
}

export function verifyInstallAuditLines(lines: string[]): InstallAuditVerifyResult {
  let expectedPrevHash = INSTALL_AUDIT_GENESIS_PREV_HASH;
  let verifiedCount = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i]?.trim();
    if (!raw) continue;

    const lineNumber = i + 1;
    let event: InstallAuditEvent;
    try {
      event = JSON.parse(raw) as InstallAuditEvent;
    } catch {
      return fail(lineNumber, 'malformed JSON');
    }

    if (!event || typeof event !== 'object') return fail(lineNumber, 'event is not an object');
    if (typeof event.eventId !== 'string' || event.eventId.length === 0) return fail(lineNumber, 'missing/invalid eventId');
    if (typeof event.prevHash !== 'string' || event.prevHash.length === 0) return fail(lineNumber, 'missing/invalid prevHash');
    if (typeof event.hash !== 'string' || event.hash.length === 0) return fail(lineNumber, 'missing/invalid hash');
    if (typeof event.schemaVersion !== 'number') return fail(lineNumber, 'missing/invalid schemaVersion');

    if (event.schemaVersion !== INSTALL_AUDIT_SCHEMA_VERSION) {
      return fail(
        lineNumber,
        `schemaVersion mismatch (expected=${INSTALL_AUDIT_SCHEMA_VERSION}, actual=${event.schemaVersion})`
      );
    }

    if (event.prevHash !== expectedPrevHash) {
      return fail(lineNumber, `prevHash mismatch (expected=${expectedPrevHash}, actual=${event.prevHash})`);
    }

    const { hash, ...payload } = event;
    const recomputed = computeInstallAuditHash(payload);
    if (recomputed !== hash) {
      return fail(lineNumber, `hash mismatch (expected=${recomputed}, actual=${hash})`);
    }

    expectedPrevHash = hash;
    verifiedCount += 1;
  }

  return {
    ok: true,
    line: 0,
    reason: `OK verified=${verifiedCount} lastHash=${expectedPrevHash}`,
    verifiedCount,
    lastHash: expectedPrevHash
  };
}

export function verifyInstallAuditFile(filePath = getInstallAuditPath()): InstallAuditVerifyResult {
  let content = '';
  try {
    content = readFileSync(filePath, 'utf8');
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return {
        ok: true,
        line: 0,
        reason: 'bootstrap: audit file missing (ENOENT)',
        verifiedCount: 0,
        lastHash: INSTALL_AUDIT_GENESIS_PREV_HASH
      };
    }

    const reason = error instanceof Error ? error.message : String(error);
    return fail(0, `failed to read file (${reason})`);
  }

  return verifyInstallAuditLines(content.split('\n'));
}
