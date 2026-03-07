#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const logPath = resolve(process.cwd(), 'data/report-delivery.log');
const rotatedPath = `${logPath}.1`;

function parseHours(argv) {
  const hoursIdx = argv.findIndex((arg) => arg === '--hours');
  if (hoursIdx === -1) return 24;
  const raw = argv[hoursIdx + 1];
  const parsed = Number.parseFloat(raw ?? '');
  if (!Number.isFinite(parsed) || parsed <= 0) return 24;
  return parsed;
}

async function safeRead(path) {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return '';
  }
}

function parseLine(line) {
  const match = line.match(/^(\S+)\s+(.*)$/);
  if (!match) return null;

  const timestamp = Date.parse(match[1]);
  if (!Number.isFinite(timestamp)) return null;

  const fields = {};
  for (const token of match[2].split(/\s+/)) {
    const eq = token.indexOf('=');
    if (eq <= 0) continue;
    const key = token.slice(0, eq);
    const value = token.slice(eq + 1);
    fields[key] = value;
  }

  return { timestamp, raw: line, fields };
}

function increment(map, key) {
  const prev = map.get(key) ?? 0;
  map.set(key, prev + 1);
}

function printCounter(title, map) {
  console.log(`\n${title}`);
  if (!map.size) {
    console.log('- (none)');
    return;
  }

  for (const [key, count] of [...map.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`- ${key}: ${count}`);
  }
}

async function main() {
  const hours = parseHours(process.argv.slice(2));
  const threshold = Date.now() - hours * 60 * 60 * 1000;

  const combined = [await safeRead(rotatedPath), await safeRead(logPath)]
    .filter(Boolean)
    .join('\n');

  const records = combined
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseLine)
    .filter(Boolean)
    .filter((entry) => entry.timestamp >= threshold)
    .sort((a, b) => b.timestamp - a.timestamp);

  const eventCounts = new Map();
  const codeCounts = new Map();
  const statusCounts = new Map();

  for (const rec of records) {
    increment(eventCounts, rec.fields.event ?? 'unknown');
    if (rec.fields.code) increment(codeCounts, rec.fields.code);
    if (rec.fields.status) increment(statusCounts, rec.fields.status);
  }

  console.log(`Delivery failures summary (last ${hours}h)`);
  console.log(`- records: ${records.length}`);
  printCounter('by event', eventCounts);
  printCounter('by code', codeCounts);
  printCounter('by status', statusCounts);

  console.log('\nrecent 3');
  for (const rec of records.slice(0, 3)) {
    console.log(`- ${rec.raw}`);
  }
  if (records.length === 0) {
    console.log('- (none)');
  }
}

main().catch((error) => {
  console.error('failed to summarize delivery failures:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
