import { Type } from '@sinclair/typebox';
import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
import { getInstallSummary } from '../../../dist/src/application/status/getInstallSummary.js';
import { getMaintenanceStatus } from '../../../dist/src/application/status/getMaintenanceStatus.js';
import { getCollectorStatus } from '../../../dist/src/application/status/getCollectorStatus.js';
import { getScoringCalibration } from '../../../dist/src/application/status/getScoringCalibration.js';
import { getRecommendationReport } from '../../../dist/src/application/recommend/getRecommendationReport.js';
import { execFileSync } from 'node:child_process';

function run(label: string, command: string, args: string[]) {
  try {
    const stdout = execFileSync(command, args, {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
    return { label, ok: true, code: 0, stdout, stderr: '' };
  } catch (error) {
    const stdout = error && typeof error === 'object' && 'stdout' in error ? String((error as { stdout?: string }).stdout ?? '').trim() : '';
    const stderr = error && typeof error === 'object' && 'stderr' in error ? String((error as { stderr?: string }).stderr ?? '').trim() : '';
    const code = error && typeof error === 'object' && 'status' in error ? Number((error as { status?: number }).status ?? 1) : 1;
    return { label, ok: false, code, stdout, stderr };
  }
}

async function buildAplusStatus() {
  const opsGate = run('ops_status_gate', 'npm', ['run', 'ops:status:gate', '--silent']);
  const collector = await getCollectorStatus();
  const collectorStdout = `collector_status mode=${collector.mode} degraded=${collector.degraded} reason=${collector.reason} threshold=${collector.threshold} skillCount=${collector.skillCount} fetchTimeoutMs=${collector.fetchTimeoutMs} fetchedAt=${collector.fetchedAt}`;
  const fastCap = run('fast_cap_inspect', 'npm', ['run', 'fast-cap:inspect', '--silent']);
  const delivery = run('delivery_failures', 'npm', ['run', 'delivery:failures', '--silent', '--', '--hours', '24']);
  const fastCapReasonMatch = fastCap.stdout.match(/\breason=("(?:\\.|[^"])*"|[^\s]+)/);
  const deliveryFailuresMatch = delivery.stdout.match(/- failures: (\d+)/);
  const fastCapReason = fastCapReasonMatch?.[1] ?? 'unknown';
  const deliveryFailures = Number.parseInt(deliveryFailuresMatch?.[1] ?? '-1', 10);

  return getMaintenanceStatus({
    opsGate: { code: opsGate.code, stdout: opsGate.stdout, stderr: opsGate.stderr },
    collectorStatus: { mode: collector.mode, stdout: collectorStdout },
    fastCapInspect: { reason: fastCapReason, stdout: fastCap.stdout, stderr: fastCap.stderr },
    deliveryFailures: {
      failures: Number.isFinite(deliveryFailures) ? deliveryFailures : 'unknown',
      stdout: delivery.stdout,
      stderr: delivery.stderr
    }
  });
}

export default definePluginEntry({
  id: 'a-plus-skill',
  name: 'A+ Skill',
  description: 'Operational status, recommendation reporting, and audit summary tools for a-plus-skill',
  register(api) {
    api.registerTool({
      name: 'aplus_status',
      description: 'Return maintenance and operational status summary for a-plus-skill.',
      parameters: Type.Object({}),
      async execute() {
        const status = await buildAplusStatus();
        return { content: [{ type: 'text', text: JSON.stringify(status, null, 2) }] };
      }
    });

    api.registerTool({
      name: 'aplus_install_summary',
      description: 'Summarize recent install audit activity for a-plus-skill.',
      parameters: Type.Object({
        hours: Type.Optional(Type.Number({ minimum: 1 }))
      }),
      async execute(_id, params) {
        const summary = getInstallSummary(params.hours ?? 24);
        return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] };
      }
    });

    api.registerTool({
      name: 'aplus_scoring_calibration',
      description: 'Return scoring distribution and decision calibration for a-plus-skill.',
      parameters: Type.Object({}),
      async execute() {
        const calibration = await getScoringCalibration();
        return { content: [{ type: 'text', text: JSON.stringify(calibration, null, 2) }] };
      }
    });

    api.registerTool({
      name: 'aplus_recommend_report',
      description: 'Generate a read-only recommendation report without install or delivery side effects.',
      parameters: Type.Object({}),
      async execute() {
        const report = await getRecommendationReport();
        return { content: [{ type: 'text', text: JSON.stringify(report, null, 2) }] };
      }
    });
  }
});
