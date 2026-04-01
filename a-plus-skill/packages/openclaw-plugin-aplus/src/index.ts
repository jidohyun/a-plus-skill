import { Type } from '@sinclair/typebox';
import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
import { getInstallSummary } from '../../../dist/src/application/status/getInstallSummary.js';
import { getMaintenanceStatus } from '../../../dist/src/application/status/getMaintenanceStatus.js';
import { getCollectorStatus } from '../../../dist/src/application/status/getCollectorStatus.js';
import { getScoringCalibration } from '../../../dist/src/application/status/getScoringCalibration.js';
import { getAuditVerify } from '../../../dist/src/application/status/getAuditVerify.js';
import { getRecommendationReport } from '../../../dist/src/application/recommend/getRecommendationReport.js';
import { getInstallPlanReport } from '../../../dist/src/application/recommend/getInstallPlanReport.js';
import { resolveRuntimeConfig } from '../../../dist/src/application/config/resolveRuntimeConfig.js';
import { execFileSync } from 'node:child_process';

const formatSchema = Type.Optional(Type.Union([Type.Literal('json'), Type.Literal('summary')]));

type ToolFormat = 'json' | 'summary';

type PluginConfigShape = {
  policy?: 'strict' | 'balanced' | 'fast';
  profileType?: 'developer' | 'automation' | 'assistant';
  hours?: number;
  format?: 'json' | 'summary';
};

function getPluginConfig(api: { config?: unknown }): PluginConfigShape {
  if (!api || !('config' in api)) return {};
  const raw = api.config;
  if (!raw || typeof raw !== 'object') return {};
  return raw as PluginConfigShape;
}

function resolveFormat(raw?: string): ToolFormat {
  return raw === 'summary' ? 'summary' : 'json';
}

function asToolText(payload: unknown, summary: string, format: ToolFormat) {
  return {
    content: [{ type: 'text', text: format === 'summary' ? summary : JSON.stringify(payload, null, 2) }]
  };
}

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

function summarizeStatus(status: ReturnType<typeof getMaintenanceStatus> extends Promise<infer T> ? T : never): string {
  const summary = status.summary;
  return `aplus_status overall=${summary.overall} severity=${summary.severity} issue_count=${summary.issue_count} primary_issue=${summary.primary_issue} recommended_action=${JSON.stringify(summary.recommended_action)}`;
}

function summarizeInstallSummary(summary: ReturnType<typeof getInstallSummary>): string {
  const actions = summary.counters.actions.slice(0, 2).map((row) => `${row.key}:${row.count}`).join(', ') || 'none';
  const statuses = summary.counters.statuses.slice(0, 2).map((row) => `${row.key}:${row.count}`).join(', ') || 'none';
  return `aplus_install_summary hours=${summary.summary.hours} records=${summary.summary.records} actions=${JSON.stringify(actions)} statuses=${JSON.stringify(statuses)}`;
}

function summarizeScoringCalibration(calibration: Awaited<ReturnType<typeof getScoringCalibration>>): string {
  const counts = calibration.decision_counts;
  return `aplus_scoring_calibration policy=${calibration.summary.policy} source=${calibration.summary.source} degraded=${calibration.summary.degraded} sample_quality=${calibration.summary.sample_quality} decisions=${JSON.stringify(`recommend=${counts.recommend} caution=${counts.caution} hold=${counts.hold} block=${counts.block}`)}`;
}

function summarizeRecommendationReport(report: Awaited<ReturnType<typeof getRecommendationReport>>): string {
  const top = report.results.slice(0, 3).map((item) => `${item.slug}:${item.decision}:${item.finalScore.toFixed(1)}`).join(', ') || 'none';
  return `aplus_recommend_report policy=${report.policy} source=${report.source} degraded=${report.degraded} results=${report.results.length} top=${JSON.stringify(top)}`;
}

function summarizeAuditVerify(result: ReturnType<typeof getAuditVerify>): string {
  return `aplus_audit_verify ok=${result.ok} line=${result.line} verifiedCount=${result.verifiedCount} path=${JSON.stringify(result.path)} reason=${JSON.stringify(result.reason)}`;
}

function summarizeInstallPlanReport(plan: Awaited<ReturnType<typeof getInstallPlanReport>>): string {
  const top = plan.items.slice(0, 3).map((item) => `${item.slug}:${item.installAction}:${item.decision}`).join(', ') || 'none';
  return `aplus_install_plan policy=${plan.policy} source=${plan.source} degraded=${plan.degraded} items=${plan.items.length} top=${JSON.stringify(top)}`;
}

export default definePluginEntry({
  id: 'a-plus-skill',
  name: 'A+ Skill',
  description: 'Operational status, recommendation reporting, and audit summary tools for a-plus-skill',
  configSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      readOnly: { type: 'boolean', description: 'Reserved flag for future plugin-side safety defaults.' },
      policy: { type: 'string', enum: ['strict', 'balanced', 'fast'] },
      profileType: { type: 'string', enum: ['developer', 'automation', 'assistant'] },
      hours: { type: 'number', minimum: 1 },
      format: { type: 'string', enum: ['json', 'summary'] }
    }
  },
  register(api) {
    const pluginConfig = getPluginConfig(api);

    api.registerTool({
      name: 'aplus_status',
      description: 'Return maintenance and operational status summary for a-plus-skill.',
      parameters: Type.Object({
        format: formatSchema
      }),
      async execute(_id, params) {
        const resolved = resolveRuntimeConfig({ toolInput: params, pluginConfig, defaults: { format: 'json' } });
        const status = await buildAplusStatus();
        return asToolText(status, summarizeStatus(status), resolveFormat(resolved.format));
      }
    });

    api.registerTool({
      name: 'aplus_install_summary',
      description: 'Summarize recent install audit activity for a-plus-skill.',
      parameters: Type.Object({
        hours: Type.Optional(Type.Number({ minimum: 1 })),
        format: formatSchema
      }),
      async execute(_id, params) {
        const resolved = resolveRuntimeConfig({ toolInput: params, pluginConfig, defaults: { hours: 24, format: 'json' } });
        const summary = getInstallSummary(resolved.hours);
        return asToolText(summary, summarizeInstallSummary(summary), resolveFormat(resolved.format));
      }
    });

    api.registerTool({
      name: 'aplus_scoring_calibration',
      description: 'Return scoring distribution and decision calibration for a-plus-skill.',
      parameters: Type.Object({
        format: formatSchema,
        policy: Type.Optional(Type.Union([Type.Literal('strict'), Type.Literal('balanced'), Type.Literal('fast')]))
      }),
      async execute(_id, params) {
        const resolved = resolveRuntimeConfig({ toolInput: params, pluginConfig, defaults: { format: 'json' } });
        const calibration = await getScoringCalibration();
        calibration.summary.policy = resolved.policy;
        return asToolText(calibration, summarizeScoringCalibration(calibration), resolveFormat(resolved.format));
      }
    });

    api.registerTool({
      name: 'aplus_recommend_report',
      description: 'Generate a read-only recommendation report without install or delivery side effects.',
      parameters: Type.Object({
        format: formatSchema,
        policy: Type.Optional(Type.Union([Type.Literal('strict'), Type.Literal('balanced'), Type.Literal('fast')])),
        profileType: Type.Optional(Type.Union([Type.Literal('developer'), Type.Literal('automation'), Type.Literal('assistant')]))
      }),
      async execute(_id, params) {
        const resolved = resolveRuntimeConfig({ toolInput: params, pluginConfig, defaults: { format: 'json' } });
        const report = await getRecommendationReport({ policy: resolved.policy, profileType: resolved.profileType });
        return asToolText(report, summarizeRecommendationReport(report), resolveFormat(resolved.format));
      }
    });

    api.registerTool({
      name: 'aplus_audit_verify',
      description: 'Verify install audit chain integrity for a-plus-skill.',
      parameters: Type.Object({
        format: formatSchema
      }),
      async execute(_id, params) {
        const resolved = resolveRuntimeConfig({ toolInput: params, pluginConfig, defaults: { format: 'json' } });
        const result = getAuditVerify();
        return asToolText(result, summarizeAuditVerify(result), resolveFormat(resolved.format));
      }
    });

    api.registerTool({
      name: 'aplus_install_plan',
      description: 'Generate a read-only install planning view without executing installs.',
      parameters: Type.Object({
        format: formatSchema,
        policy: Type.Optional(Type.Union([Type.Literal('strict'), Type.Literal('balanced'), Type.Literal('fast')])),
        profileType: Type.Optional(Type.Union([Type.Literal('developer'), Type.Literal('automation'), Type.Literal('assistant')]))
      }),
      async execute(_id, params) {
        const resolved = resolveRuntimeConfig({ toolInput: params, pluginConfig, defaults: { format: 'json' } });
        const plan = await getInstallPlanReport({ policy: resolved.policy, profileType: resolved.profileType });
        return asToolText(plan, summarizeInstallPlanReport(plan), resolveFormat(resolved.format));
      }
    });
  }
});
