import { getCollectorStatus } from '../src/application/status/getCollectorStatus.ts';

const strict = process.argv.includes('--strict') || process.env.COLLECTOR_STATUS_STRICT === 'true';
const jsonMode = process.argv.includes('--json');

const status = await getCollectorStatus();

if (jsonMode) {
  console.log(JSON.stringify(status));
} else {
  console.log(
    `collector_status mode=${status.mode} degraded=${status.degraded} reason=${status.reason} threshold=${status.threshold} skillCount=${status.skillCount} fetchTimeoutMs=${status.fetchTimeoutMs} fetchedAt=${status.fetchedAt}`
  );
}

if (strict && status.mode === 'fallback') {
  process.exit(2);
}
