import { readFileSync } from 'node:fs';
import { getInstallAuditPath } from '../../install/auditIntegrity.js';

export type CounterRow = {
  key: string;
  count: number;
};

export type InstallSummaryRecentEvent = {
  ts: string;
  slug: string;
  action: string;
  status: string;
  degraded: boolean;
  error: string;
  notes: string[];
};

export type InstallSummaryResult = {
  summary: {
    hours: number;
    path: string;
    records: number;
  };
  counters: {
    actions: CounterRow[];
    statuses: CounterRow[];
    notes: CounterRow[];
    errors: CounterRow[];
  };
  recent_events: InstallSummaryRecentEvent[];
};

function increment(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

export function counterRows(map: Map<string, number>, limit = 10): CounterRow[] {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([key, count]) => ({ key, count }));
}

export function getInstallSummary(hours = 24): InstallSummaryResult {
  const normalizedHours = Math.max(1, hours);
  const cutoff = Date.now() - normalizedHours * 60 * 60 * 1000;
  const auditPath = getInstallAuditPath();

  let content = '';
  try {
    content = readFileSync(auditPath, 'utf8');
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return {
        summary: { hours: normalizedHours, path: auditPath, records: 0 },
        counters: { actions: [], statuses: [], notes: [], errors: [] },
        recent_events: []
      };
    }
    throw error;
  }

  const lines = content.split('\n').map((line) => line.trim()).filter(Boolean);
  const records: Record<string, unknown>[] = [];
  for (const line of lines) {
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      const ts = Date.parse(String(event.ts ?? ''));
      if (!Number.isFinite(ts) || ts < cutoff) continue;
      records.push(event);
    } catch {
      // ignore malformed historical line for summary purposes
    }
  }

  const actionCounts = new Map<string, number>();
  const statusCounts = new Map<string, number>();
  const noteCounts = new Map<string, number>();
  const errorCounts = new Map<string, number>();

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

  const recentEvents: InstallSummaryRecentEvent[] = records.slice(-3).reverse().map((event) => ({
    ts: String(event.ts ?? ''),
    slug: String(event.slug ?? ''),
    action: String(event.action ?? ''),
    status: String(event.status ?? ''),
    degraded: Boolean(event.degraded),
    error: event.errorCode ? String(event.errorCode) : 'none',
    notes: Array.isArray(event.notes) && event.notes.length > 0 ? event.notes.filter((note): note is string => typeof note === 'string').slice(0, 2) : []
  }));

  return {
    summary: { hours: normalizedHours, path: auditPath, records: records.length },
    counters: {
      actions: counterRows(actionCounts),
      statuses: counterRows(statusCounts),
      notes: counterRows(noteCounts, 8),
      errors: counterRows(errorCounts, 8)
    },
    recent_events: recentEvents
  };
}
