#!/usr/bin/env node
import { getInstallSummary } from '../src/application/status/getInstallSummary.ts';

const jsonMode = process.argv.includes('--json');

function printCounter(title, rows) {
  console.log(title);
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
const summary = getInstallSummary(hours);

if (jsonMode) {
  console.log(JSON.stringify(summary));
} else {
  console.log(`install_summary hours=${summary.summary.hours} path=${summary.summary.path} records=${summary.summary.records}`);
  printCounter('by action', summary.counters.actions);
  printCounter('by status', summary.counters.statuses);
  printCounter('top notes', summary.counters.notes);
  printCounter('by error', summary.counters.errors);
  console.log('recent events');
  if (summary.recent_events.length === 0) {
    console.log('- none');
  } else {
    for (const event of summary.recent_events) {
      const noteSummary = event.notes.length > 0 ? event.notes.join('; ') : 'none';
      console.log(
        `- ${event.ts} slug=${event.slug} action=${event.action} status=${event.status} degraded=${event.degraded} error=${event.error} notes=${JSON.stringify(noteSummary)}`
      );
    }
  }
}
