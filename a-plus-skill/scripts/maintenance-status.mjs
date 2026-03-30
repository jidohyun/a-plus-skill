#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const cwd = process.cwd();
const nodeBin = process.execPath;
const tsxLoader = resolve(cwd, 'node_modules', 'tsx', 'dist', 'loader.mjs');

function run(label, command, args) {
  try {
    const stdout = execFileSync(command, args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
    return { label, ok: true, code: 0, stdout };
  } catch (error) {
    const stdout = error && typeof error === 'object' && 'stdout' in error ? String(error.stdout ?? '').trim() : '';
    const stderr = error && typeof error === 'object' && 'stderr' in error ? String(error.stderr ?? '').trim() : '';
    const code = error && typeof error === 'object' && 'status' in error ? Number(error.status ?? 1) : 1;
    return { label, ok: false, code, stdout, stderr };
  }
}

const checks = [
  run('ops_status_gate', 'npm', ['run', 'ops:status:gate', '--silent']),
  run('collector_status', nodeBin, ['--import', tsxLoader, 'scripts/collector-status.mjs']),
  run('fast_cap_inspect', 'npm', ['run', 'fast-cap:inspect', '--silent']),
  run('delivery_failures', 'npm', ['run', 'delivery:failures', '--silent', '--', '--hours', '24'])
];

const opsGate = checks.find((check) => check.label === 'ops_status_gate');
const collector = checks.find((check) => check.label === 'collector_status');
const fastCap = checks.find((check) => check.label === 'fast_cap_inspect');
const delivery = checks.find((check) => check.label === 'delivery_failures');
const collectorModeMatch = collector?.stdout.match(/\bmode=([^\s]+)/);
const fastCapReasonMatch = fastCap?.stdout.match(/\breason=("(?:\\.|[^"])*"|[^\s]+)/);
const deliveryFailuresMatch = delivery?.stdout.match(/- failures: (\d+)/);
const collectorMode = collectorModeMatch?.[1] ?? 'unknown';
const fastCapReason = fastCapReasonMatch?.[1] ?? 'unknown';
const deliveryFailures = Number.parseInt(deliveryFailuresMatch?.[1] ?? '-1', 10);

const hasOpsGateFailure = (opsGate?.code ?? 1) !== 0;
const hasFastCapAttention = fastCapReason !== '"not_initialized"' && fastCapReason !== '"none"' && fastCapReason !== 'none';
const hasCollectorFallback = collectorMode === 'fallback';
const hasDeliveryFailures = Number.isFinite(deliveryFailures) && deliveryFailures > 0;
const issueCount = [hasOpsGateFailure, hasFastCapAttention, hasCollectorFallback, hasDeliveryFailures].filter(Boolean).length;

let overall = 'healthy';
let primaryIssue = 'none';
let recommendedAction = 'none';
let severity = 'info';

if (hasOpsGateFailure) {
  overall = 'nonhealthy';
  primaryIssue = 'ops_gate_fail';
  recommendedAction = 'run npm run ops:status and inspect critical_flags';
  severity = 'critical';
} else if (hasFastCapAttention) {
  overall = 'degraded';
  primaryIssue = 'fast_cap_attention';
  recommendedAction = 'run npm run fast-cap:inspect and follow fast-cap runbook';
  severity = 'high';
} else if (hasCollectorFallback) {
  overall = 'degraded';
  primaryIssue = 'collector_fallback';
  recommendedAction = 'inspect collector_status reason and upstream ClawHub reachability';
  severity = 'medium';
} else if (hasDeliveryFailures) {
  overall = 'degraded';
  primaryIssue = 'delivery_failures';
  recommendedAction = 'run npm run delivery:failures -- --hours 24';
  severity = 'medium';
}

console.log(
  `maintenance_status overall=${overall} severity=${severity} issue_count=${issueCount} ops_gate_code=${opsGate?.code ?? 'unknown'} collector_mode=${collectorMode} fast_cap_reason=${fastCapReason} delivery_failures=${Number.isFinite(deliveryFailures) ? deliveryFailures : 'unknown'} primary_issue=${JSON.stringify(primaryIssue)} recommended_action=${JSON.stringify(recommendedAction)}`
);
console.log('');

for (const check of checks) {
  const summary = check.stdout || check.stderr || '(no output)';
  console.log(`[${check.label}] ok=${check.ok} code=${check.code}`);
  console.log(summary);
  console.log('');
}

const hasHardFailure = checks.some((check) => check.label === 'ops_status_gate' && check.code !== 0);
process.exit(hasHardFailure ? 2 : 0);
