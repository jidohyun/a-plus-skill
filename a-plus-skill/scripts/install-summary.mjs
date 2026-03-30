#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { getInstallAuditPath } from '../src/install/auditIntegrity.ts';

const jsonMode = process.argv.includes('--json');

function increment(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function counterRows(map, limit = 10) {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([key, count]) => ({ key, count }));
}

function printCounter(title, map, limit = 10) {
  console.log(title);
  const rows = counterRows(map, limit);
  if (rows.length === 0) {
    console.log('- none');
    return;
  }
  for (const row of rows) {
    console.log(`- ${row.key}: ${row.count}`);
  }
}

const hoursArgIndex = process.argv.indexOf('--hours');
const hours = hoursArgIndex >= 0 ? Number.parseFloat(process.argv[hoursArgIndex + 1] ?? '24') : 24;
const cutoff = Date.now() - Math.max(1, hours) * 60 * 60 * 1000;
const auditPath = getInstallAuditPath();

let content = '';
try {
  content = readFileSync(auditPath, 'utf8');
} catch (error) {
  if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
    if (jsonMode) {
      console.log(
        JSON.stringify({
          summary: { hours, path: auditPath, records: 0 },
          counters: { actions: [], statuses: [], notes: [], errors: [] },
          recent_events: []
        })
      );
    } else {
      console.log(`install_summary hours=${hours} path=${auditPath} records=0`);
      console.log('recent events');
      console.log('- none');
    }
    process.exit(0);
  }
  throw error;
}

const lines = content.split('\n').map((line) => line.trim()).filter(Boolean);
const records = [];
for (const line of lines) {
  try {
    const event = JSON.parse(line);
    const ts = Date.parse(String(event.ts ?? ''));
    if (!Number.isFinite(ts) || ts < cutoff) continue;
    records.push(event);
  } catch {
    // ignore malformed historical line for summary purposes
  }
}

const actionCounts = new Map();
const statusCounts = new Map();
const noteCounts = new Map();
const errorCounts = new Map();

for (const event of records) {
  if (event.action) increment(actionCounts, String(event.action));
  if (event.status) increment(statusCounts, String(event.status));
  if (event.errorCode) increment(errorCounts, String(event.errorCode));
  if (Array.isArray(event.notes)) {
    for (const note of event.notes) {
      if (typeof note === 'string' && note.trim()) increment(noteCounts, note.trim());
    }
  }
}

const recentEvents = records.slice(-3).reverse().map((event) => ({
  ts: event.ts,
  slug: event.slug,
  action: event.action,
  status: event.status,
  degraded: event.degraded,
  error: event.errorCode ?? 'none',
  notes: Array.isArray(event.notes) && event.notes.length > 0 ? event.notes.slice(0, 2) : []
}));

if (jsonMode) {
  console.log(
    JSON.stringify({
      summary: { hours, path: auditPath, records: records.length },
      counters: {
        actions: counterRows(actionCounts),
        statuses: counterRows(statusCounts),
        notes: counterRows(noteCounts, 8),
        errors: counterRows(errorCounts, 8)
      },
      recent_events: recentEvents
    })
  );
} else {
  console.log(`install_summary hours=${hours} path=${auditPath} records=${records.length}`);
  printCounter('by action', actionCounts);
  printCounter('by status', statusCounts);
  printCounter('top notes', noteCounts, 8);
  printCounter('by error', errorCounts, 8);
  console.log('recent events');
  if (recentEvents.length === 0) {
    console.log('- none');
  } else {
    for (const event of recentEvents) {
      const noteSummary = event.notes.length > 0 ? event.notes.join('; ') : 'none';
      console.log(
        `- ${event.ts} slug=${event.slug} action=${event.action} status=${event.status} degraded=${event.degraded} error=${event.error} notes=${JSON.stringify(noteSummary)}`
      );
    }
  }
}
