import { readdirSync, readFileSync } from 'node:fs';
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
const deliveryLogPath = process.env.OPS_REPORT_DELIVERY_LOG_PATH?.trim() || resolve(cwd, 'data', 'report-delivery.log');
const DEFAULT_DELIVERY_SUCCESS_STALE_SEC = 8 * 24 * 60 * 60;

function parseArgs(argv = process.argv.slice(2)) {
  let strictMode = null;
  let strictModeError = null;

  for (const arg of argv) {
    if (arg === '--strict') {
      strictMode = 'unhealthy';
      continue;
    }
    if (arg.startsWith('--strict=')) {
      const value = arg.slice('--strict='.length).trim();
      if (value === 'nonhealthy') {
        strictMode = 'nonhealthy';
      } else if (value === 'unhealthy') {
        strictMode = 'unhealthy';
      } else {
        strictModeError = value;
      }
    }
  }

  return { strictMode, strictModeError };
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

function getDeliveryLogPaths(basePath) {
  const dir = dirname(basePath);
  const baseName = basePath.split(/[\\/]/).pop() ?? 'report-delivery.log';

  let names = [];
  try {
    names = readdirSync(dir);
  } catch {
    return [basePath];
  }

  return names
    .filter((name) => name === baseName || (name.startsWith(`${baseName}.`) && !name.endsWith('.gz')))
    .map((name) => resolve(dir, name))
    .sort((a, b) => a.localeCompare(b));
}

function parseDeliveryLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const firstSpace = trimmed.indexOf(' ');
  if (firstSpace <= 0) return { parseError: true };

  const tsRaw = trimmed.slice(0, firstSpace);
  const tsMs = Date.parse(tsRaw);
  if (!Number.isFinite(tsMs)) return { parseError: true };

  const fields = trimmed.slice(firstSpace + 1).trim().split(/\s+/g);
  let event = '';
  for (const field of fields) {
    const [k, ...rest] = field.split('=');
    if (k === 'event') {
      event = rest.join('=');
      break;
    }
  }

  if (!event) return { parseError: true };
  return { tsMs, event };
}

function getDeliveryStaleThresholdSec() {
  const raw = process.env.OPS_DELIVERY_SUCCESS_STALE_SEC?.trim();
  if (!raw) return DEFAULT_DELIVERY_SUCCESS_STALE_SEC;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_DELIVERY_SUCCESS_STALE_SEC;
  return parsed;
}

function readDeliveryHealth(modeRaw) {
  if (modeRaw === 'none') {
    return {
      health: 'disabled',
      lastSuccessAgeSec: -1,
      failures: 0,
      successes: 0,
      parseFault: false,
      noSignal: false,
      stale: false
    };
  }

  let successes = 0;
  let failures = 0;
  let lastSuccessTsMs = 0;
  let parseFault = false;
  let foundAnyLog = false;

  const logPaths = getDeliveryLogPaths(deliveryLogPath);
  for (const path of logPaths) {
    let raw = '';
    try {
      raw = readFileSync(path, 'utf8');
      foundAnyLog = true;
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined;
      if (code === 'ENOENT') {
        continue;
      }
      parseFault = true;
      continue;
    }

    const lines = raw.split('\n');
    for (const line of lines) {
      const parsed = parseDeliveryLine(line);
      if (!parsed) continue;
      if (parsed.parseError) {
        parseFault = true;
        continue;
      }

      if (parsed.event === 'delivery_success') {
        successes += 1;
        if (parsed.tsMs > lastSuccessTsMs) {
          lastSuccessTsMs = parsed.tsMs;
        }
      } else if (parsed.event === 'delivery_failed') {
        failures += 1;
      }
    }
  }

  const nowMs = Date.now();
  const lastSuccessAgeSec = lastSuccessTsMs > 0 ? Math.max(0, Math.floor((nowMs - lastSuccessTsMs) / 1000)) : -1;
  const staleThreshold = getDeliveryStaleThresholdSec();
  const stale = lastSuccessAgeSec >= 0 && lastSuccessAgeSec > staleThreshold;
  const noSignal = successes === 0 || !foundAnyLog;

  let health = 'healthy';
  if (parseFault) {
    health = 'degraded';
  }
  if (noSignal || stale) {
    health = 'unhealthy';
  }

  return { health, lastSuccessAgeSec, failures, successes, parseFault, noSignal, stale };
}

function q(value) {
  return JSON.stringify(String(value));
}

function main() {
  const args = parseArgs();
  if (args.strictModeError !== null) {
    console.error(
      `ERROR invalid --strict mode ${q(args.strictModeError)}; expected one of: "unhealthy", "nonhealthy"`
    );
    process.exit(2);
  }

  const policy = loadPolicyFromEnv('balanced');

  const auditPath = getInstallAuditPath();
  const audit = verifyInstallAuditFile(auditPath);
  const strictState = readStrictEvidenceState(strictStatePath);

  const cap = parseFastAuditFailMaxInstalls();
  const fastCap = readFastCapStatus(fastCapStatePath, fastCapKeyPath);
  const fastCapExceeded = fastCap.count > cap;

  const deliveryMode = (process.env.REPORT_DELIVERY ?? 'none').trim().toLowerCase();
  const delivery = readDeliveryHealth(deliveryMode);

  let overall = 'healthy';

  if (policy === 'strict') {
    if (!audit.ok || strictState.fault || fastCap.tampered || (deliveryMode !== 'none' && (delivery.noSignal || delivery.stale))) {
      overall = 'unhealthy';
    } else if (strictState.failures > 0 || delivery.parseFault) {
      overall = 'degraded';
    }
  } else if (policy === 'balanced') {
    if (!audit.ok || strictState.fault || strictState.failures > 0 || fastCap.tampered) {
      overall = 'degraded';
    }
    if (deliveryMode !== 'none' && (delivery.noSignal || delivery.stale || delivery.parseFault)) {
      overall = 'degraded';
    }
  } else {
    if (fastCap.tampered || fastCapExceeded) {
      overall = 'unhealthy';
    } else if (strictState.fault || strictState.failures > 0) {
      overall = 'degraded';
    }
    if (deliveryMode !== 'none' && (delivery.noSignal || delivery.stale || delivery.parseFault)) {
      overall = 'degraded';
    }
  }

  const criticalFlags = [];
  if (fastCap.tampered) {
    criticalFlags.push('fast_cap_tampered');
  }
  if (strictState.fault) {
    criticalFlags.push('strict_state_fault');
  }
  if (!audit.ok) {
    criticalFlags.push('audit_failed');
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
    `delivery_health=${delivery.health}`,
    `delivery_last_success_age_sec=${delivery.lastSuccessAgeSec}`,
    `delivery_failures=${delivery.failures}`,
    `delivery_successes=${delivery.successes}`,
    `critical_flags_present=${criticalFlags.length > 0}`,
    `critical_flags=${q(criticalFlags.join(','))}`,
    `overall=${overall}`
  ];

  console.log(fields.join(' '));

  if (args.strictMode) {
    const fail = args.strictMode === 'unhealthy' ? overall === 'unhealthy' : overall !== 'healthy';
    if (fail) {
      process.exit(2);
    }
  }
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : '';
const thisPath = fileURLToPath(import.meta.url);
if (entryPath === thisPath) {
  main();
}
