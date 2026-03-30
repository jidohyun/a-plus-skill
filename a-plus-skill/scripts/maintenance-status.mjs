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

for (const check of checks) {
  const summary = check.stdout || check.stderr || '(no output)';
  console.log(`[${check.label}] ok=${check.ok} code=${check.code}`);
  console.log(summary);
  console.log('');
}

const hasHardFailure = checks.some((check) => check.label === 'ops_status_gate' && check.code !== 0);
process.exit(hasHardFailure ? 2 : 0);
