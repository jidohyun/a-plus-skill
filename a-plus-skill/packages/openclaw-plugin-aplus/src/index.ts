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
import {
  asToolText,
  formatSchema,
  getPluginConfig,
  policySchema,
  profileTypeSchema,
  resolveFormat
} from './toolHelpers.js';
import {
  summarizeAuditVerify,
  summarizeInstallPlanReport,
  summarizeInstallSummary,
  summarizeRecommendationReport,
  summarizeScoringCalibration,
  summarizeStatus
} from './summaries.js';

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
        return asToolText('aplus_status', status, summarizeStatus(status), resolveFormat(resolved.format));
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
        return asToolText('aplus_install_summary', summary, summarizeInstallSummary(summary), resolveFormat(resolved.format));
      }
    });

    api.registerTool({
      name: 'aplus_scoring_calibration',
      description: 'Return scoring distribution and decision calibration for a-plus-skill.',
      parameters: Type.Object({
        format: formatSchema,
        policy: policySchema,
        profileType: profileTypeSchema
      }),
      async execute(_id, params) {
        const resolved = resolveRuntimeConfig({ toolInput: params, pluginConfig, defaults: { format: 'json' } });
        const calibration = await getScoringCalibration({ policy: resolved.policy, profileType: resolved.profileType });
        return asToolText('aplus_scoring_calibration', calibration, summarizeScoringCalibration(calibration), resolveFormat(resolved.format));
      }
    });

    api.registerTool({
      name: 'aplus_recommend_report',
      description: 'Generate a read-only recommendation report without install or delivery side effects.',
      parameters: Type.Object({
        format: formatSchema,
        policy: policySchema,
        profileType: profileTypeSchema
      }),
      async execute(_id, params) {
        const resolved = resolveRuntimeConfig({ toolInput: params, pluginConfig, defaults: { format: 'json' } });
        const report = await getRecommendationReport({ policy: resolved.policy, profileType: resolved.profileType });
        return asToolText('aplus_recommend_report', report, summarizeRecommendationReport(report), resolveFormat(resolved.format));
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
        return asToolText('aplus_audit_verify', result, summarizeAuditVerify(result), resolveFormat(resolved.format));
      }
    });

    api.registerTool({
      name: 'aplus_install_plan',
      description: 'Generate a read-only install planning view without executing installs.',
      parameters: Type.Object({
        format: formatSchema,
        policy: policySchema,
        profileType: profileTypeSchema
      }),
      async execute(_id, params) {
        const resolved = resolveRuntimeConfig({ toolInput: params, pluginConfig, defaults: { format: 'json' } });
        const plan = await getInstallPlanReport({ policy: resolved.policy, profileType: resolved.profileType });
        return asToolText('aplus_install_plan', plan, summarizeInstallPlanReport(plan), resolveFormat(resolved.format));
      }
    });
  }
});
