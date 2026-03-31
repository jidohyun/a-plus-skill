#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const cwd = process.cwd();
const nodeBin = process.execPath;
const tsxLoader = resolve(cwd, 'node_modules', 'tsx', 'dist', 'loader.mjs');
const jsonMode = process.argv.includes('--json');

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

const opsGate = run('ops_status_gate', 'npm', ['run', 'ops:status:gate', '--silent']);
const collector = run('collector_status', nodeBin, ['--import', tsxLoader, 'scripts/collector-status.mjs']);
const fastCap = run('fast_cap_inspect', 'npm', ['run', 'fast-cap:inspect', '--silent']);
const delivery = run('delivery_failures', 'npm', ['run', 'delivery:failures', '--silent', '--', '--hours', '24']);
const collectorModeMatch = collector.stdout.match(/\bmode=([^\s]+)/);
const fastCapReasonMatch = fastCap.stdout.match(/\breason=("(?:\\.|[^"])*"|[^\s]+)/);
const deliveryFailuresMatch = delivery.stdout.match(/- failures: (\d+)/);
const collectorMode = collectorModeMatch?.[1] ?? 'unknown';
const fastCapReason = fastCapReasonMatch?.[1] ?? 'unknown';
const deliveryFailures = Number.parseInt(deliveryFailuresMatch?.[1] ?? '-1', 10);

const { getMaintenanceStatus } = await import('../src/application/status/getMaintenanceStatus.ts');
const status = getMaintenanceStatus({
  opsGate: { code: opsGate.code, stdout: opsGate.stdout, stderr: opsGate.stderr },
  collectorStatus: { mode: collectorMode, stdout: collector.stdout, stderr: collector.stderr },
  fastCapInspect: { reason: fastCapReason, stdout: fastCap.stdout, stderr: fastCap.stderr },
  deliveryFailures: {
    failures: Number.isFinite(deliveryFailures) ? deliveryFailures : 'unknown',
    stdout: delivery.stdout,
    stderr: delivery.stderr
  }
});

if (jsonMode) {
  console.log(JSON.stringify(status));
} else {
  const summary = status.summary;
  console.log(
    `maintenance_status overall=${summary.overall} severity=${summary.severity} issue_count=${summary.issue_count} ops_gate_code=${summary.ops_gate_code} collector_mode=${summary.collector_mode} fast_cap_reason=${summary.fast_cap_reason} delivery_failures=${summary.delivery_failures} primary_issue=${JSON.stringify(summary.primary_issue)} recommended_action=${JSON.stringify(summary.recommended_action)}`
  );
  console.log('');

  for (const check of status.checks) {
    const body = check.stdout || check.stderr || '(no output)';
    console.log(`[${check.label}] ok=${check.ok} code=${check.code}`);
    console.log(body);
    console.log('');
  }
}

process.exit(opsGate.code !== 0 ? 2 : 0);
