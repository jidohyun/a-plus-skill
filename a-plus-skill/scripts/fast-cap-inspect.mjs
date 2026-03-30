#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const cwd = process.cwd();
const statePath = process.env.OPS_FAST_CAP_STATE_PATH?.trim() || resolve(cwd, 'data', 'fast-audit-fail-cap.json');
const keyPath = process.env.OPS_FAST_CAP_KEY_PATH?.trim() || resolve(dirname(statePath), 'fast-audit-fail-cap.key');

function q(value) {
  return JSON.stringify(String(value));
}

function computeChecksum(key, schemaVersion, count, updatedAt) {
  return createHash('sha256').update(`${schemaVersion}:${count}:${updatedAt}:${key}`, 'utf8').digest('hex');
}

function readText(path) {
  try {
    return { ok: true, value: readFileSync(path, 'utf8') };
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'unknown';
    return { ok: false, code };
  }
}

function main() {
  const keyRead = readText(keyPath);
  const stateRead = readText(statePath);

  const key = keyRead.ok ? keyRead.value.trim() : '';
  const keyExists = keyRead.ok && key.length > 0;
  const stateExists = stateRead.ok;

  let schemaVersion = -1;
  let count = -1;
  let updatedAt = '';
  let checksum = '';
  let expectedChecksum = '';
  let parsed = false;
  let consistent = false;
  let reason = 'none';

  if (!stateExists) {
    if (keyExists) {
      reason = 'suspicious fast-cap reset: key exists while state missing';
    }
  } else {
    try {
      const obj = JSON.parse(stateRead.value);
      parsed = true;
      schemaVersion = Number(obj?.schemaVersion);
      count = Number(obj?.count);
      updatedAt = String(obj?.updatedAt ?? '');
      checksum = String(obj?.checksum ?? '');

      if (!Number.isFinite(count) || count < 0 || schemaVersion !== 1 || !updatedAt || !checksum) {
        reason = 'state_schema_invalid';
      } else if (!keyExists) {
        reason = 'key_missing_for_state';
      } else {
        expectedChecksum = computeChecksum(key, schemaVersion, Math.floor(count), updatedAt);
        if (expectedChecksum !== checksum) {
          reason = 'checksum_mismatch';
        } else {
          consistent = true;
        }
      }
    } catch {
      reason = 'state_parse_failed';
    }
  }

  const fields = [
    `state_path=${q(statePath)}`,
    `key_path=${q(keyPath)}`,
    `state_exists=${stateExists}`,
    `key_exists=${keyExists}`,
    `state_parse_ok=${parsed}`,
    `schema_version=${schemaVersion}`,
    `count=${count}`,
    `updated_at=${q(updatedAt || 'none')}`,
    `checksum=${q(checksum || 'none')}`,
    `expected_checksum=${q(expectedChecksum || 'none')}`,
    `consistent=${consistent}`,
    `reason=${q(reason)}`
  ];

  if (!stateRead.ok) {
    fields.push(`state_read_error=${q(stateRead.code)}`);
  }
  if (!keyRead.ok) {
    fields.push(`key_read_error=${q(keyRead.code)}`);
  }

  console.log(fields.join(' '));
  process.exit(consistent ? 0 : 2);
}

main();
