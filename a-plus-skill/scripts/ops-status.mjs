import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadPolicyFromEnv } from '../src/install/confirm.ts';
import { parseFastAuditFailMaxInstalls } from '../src/index.ts';
import { getInstallAuditPath, verifyInstallAuditFile } from '../src/install/auditIntegrity.js';

const cwd = process.cwd();
const strictStatePath = process.env.OPS_STRICT_STATE_PATH?.trim() || resolve(cwd, 'data', 'strict-evidence-fail-state.json');
const fastCapStatePath = process.env.OPS_FAST_CAP_STATE_PATH?.trim() || resolve(cwd, 'data', 'fast-audit-fail-cap.json');
const fastCapKeyPath = process.env.OPS_FAST_CAP_KEY_PATH?.trim() || resolve(dirname(fastCapStatePath), 'fast-audit-fail-cap.key');

function parseArgs(argv = process.argv.slice(2)) {
  return {
    strict: argv.includes('--strict')
  };
}

function readStrictEvidenceState(path) {
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw);
    const failures = Number(parsed?.consecutiveFailures);
    if (!Number.isFinite(failures) || failures < 0) {
      return { failures: 0, fault: true, reason: 'schema_invalid' };
    }
    return { failures: Math.floor(failures), fault: false, reason: 'none' };
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined;
    if (code === 'ENOENT') {
      return { failures: 0, fault: false, reason: 'none' };
    }
    if (error instanceof SyntaxError) {
      return { failures: 0, fault: true, reason: 'parse_error' };
    }
    return { failures: 0, fault: true, reason: `read_error:${code ?? 'unknown'}` };
  }
}

function computeFastCapChecksum(key, schemaVersion, count, updatedAt) {
  return createHash('sha256').update(`${schemaVersion}:${count}:${updatedAt}:${key}`, 'utf8').digest('hex');
}

function readFastCapStatus(statePath, keyPath) {
  let key = '';
  let keyExists = false;

  try {
    key = readFileSync(keyPath, 'utf8').trim();
    keyExists = key.length > 0;
  } catch {
    keyExists = false;
  }

  let raw = '';
  try {
    raw = readFileSync(statePath, 'utf8');
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined;
    if (code === 'ENOENT') {
      if (keyExists) {
        return { count: 0, tampered: true, reason: 'suspicious fast-cap reset: key exists while state missing' };
      }
      return { count: 0, tampered: false, reason: 'none' };
    }
    return { count: 0, tampered: true, reason: 'state_read_failed' };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { count: 0, tampered: true, reason: 'state_parse_failed' };
  }

  const count = Number(parsed?.count);
  const schemaVersion = Number(parsed?.schemaVersion);
  const updatedAt = String(parsed?.updatedAt ?? '');
  const checksum = String(parsed?.checksum ?? '');

  if (!Number.isFinite(count) || count < 0 || schemaVersion !== 1 || !updatedAt || !checksum) {
    return { count: 0, tampered: true, reason: 'state_schema_invalid' };
  }

  if (!keyExists) {
    return { count: 0, tampered: true, reason: 'key_missing_for_state' };
  }

  const expected = computeFastCapChecksum(key, schemaVersion, Math.floor(count), updatedAt);
  if (expected !== checksum) {
    return { count: 0, tampered: true, reason: 'checksum_mismatch' };
  }

  return { count: Math.floor(count), tampered: false, reason: 'none' };
}

function q(value) {
  return JSON.stringify(String(value));
}

function main() {
  const args = parseArgs();
  const policy = loadPolicyFromEnv('balanced');

  const auditPath = getInstallAuditPath();
  const audit = verifyInstallAuditFile(auditPath);
  const strictState = readStrictEvidenceState(strictStatePath);

  const cap = parseFastAuditFailMaxInstalls();
  const fastCap = readFastCapStatus(fastCapStatePath, fastCapKeyPath);
  const fastCapExceeded = fastCap.count > cap;

  let overall = 'healthy';

  if (policy === 'strict') {
    if (!audit.ok || strictState.fault) {
      overall = 'unhealthy';
    } else if (strictState.failures > 0) {
      overall = 'degraded';
    }
  } else if (policy === 'balanced') {
    if (!audit.ok || strictState.fault || strictState.failures > 0) {
      overall = 'degraded';
    }
  } else {
    if (fastCap.tampered || fastCapExceeded) {
      overall = 'unhealthy';
    } else if (strictState.fault || strictState.failures > 0) {
      overall = 'degraded';
    }
  }

  const fields = [
    `policy=${policy}`,
    `audit_ok=${audit.ok}`,
    `audit_reason=${q(audit.reason)}`,
    `audit_line=${audit.line}`,
    `strict_failures=${strictState.failures}`,
    `strict_state_fault=${strictState.fault}`,
    `fast_cap_count=${fastCap.count}`,
    `fast_cap_cap=${cap}`,
    `fast_cap_tampered=${fastCap.tampered}`,
    `overall=${overall}`
  ];

  console.log(fields.join(' '));

  if (args.strict && overall === 'unhealthy') {
    process.exit(2);
  }
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : '';
const thisPath = fileURLToPath(import.meta.url);
if (entryPath === thisPath) {
  main();
}
