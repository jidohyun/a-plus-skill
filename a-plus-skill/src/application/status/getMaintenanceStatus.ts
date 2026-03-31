export type MaintenanceCheck = {
  label: string;
  ok: boolean;
  code: number;
  stdout: string;
  stderr: string;
};

export type MaintenanceStatusResult = {
  summary: {
    overall: string;
    severity: string;
    issue_count: number;
    ops_gate_code: number | string;
    collector_mode: string;
    fast_cap_reason: string;
    delivery_failures: number | string;
    primary_issue: string;
    recommended_action: string;
  };
  checks: MaintenanceCheck[];
};

export type MaintenanceDependencyResults = {
  opsGate: { code: number; stdout: string; stderr?: string };
  collectorStatus: { mode: string; stdout: string; stderr?: string };
  fastCapInspect: { reason: string; stdout: string; stderr?: string };
  deliveryFailures: { failures: number | string; stdout: string; stderr?: string };
};

export function getMaintenanceStatus(results: MaintenanceDependencyResults): MaintenanceStatusResult {
  const hasOpsGateFailure = results.opsGate.code !== 0;
  const hasFastCapAttention = results.fastCapInspect.reason !== '"not_initialized"' && results.fastCapInspect.reason !== '"none"' && results.fastCapInspect.reason !== 'none';
  const hasCollectorFallback = results.collectorStatus.mode === 'fallback';
  const hasDeliveryFailures = typeof results.deliveryFailures.failures === 'number' && Number.isFinite(results.deliveryFailures.failures) && results.deliveryFailures.failures > 0;
  const issueCount = [hasOpsGateFailure, hasFastCapAttention, hasCollectorFallback, hasDeliveryFailures].filter(Boolean).length;

  let overall = 'healthy';
  let primaryIssue = 'none';
  let recommendedAction = 'none';
  let severity = 'info';

  if (hasOpsGateFailure) {
    overall = 'nonhealthy';
    primaryIssue = 'ops_gate_fail';
    recommendedAction = 'run npm run ops:status and inspect critical_flags';
    severity = 'critical';
  } else if (hasFastCapAttention) {
    overall = 'degraded';
    primaryIssue = 'fast_cap_attention';
    recommendedAction = 'run npm run fast-cap:inspect and follow fast-cap runbook';
    severity = 'high';
  } else if (hasCollectorFallback) {
    overall = 'degraded';
    primaryIssue = 'collector_fallback';
    recommendedAction = 'inspect collector_status reason and upstream ClawHub reachability';
    severity = 'medium';
  } else if (hasDeliveryFailures) {
    overall = 'degraded';
    primaryIssue = 'delivery_failures';
    recommendedAction = 'run npm run delivery:failures -- --hours 24';
    severity = 'medium';
  }

  return {
    summary: {
      overall,
      severity,
      issue_count: issueCount,
      ops_gate_code: results.opsGate.code,
      collector_mode: results.collectorStatus.mode,
      fast_cap_reason: results.fastCapInspect.reason,
      delivery_failures: results.deliveryFailures.failures,
      primary_issue: primaryIssue,
      recommended_action: recommendedAction
    },
    checks: [
      {
        label: 'ops_status_gate',
        ok: results.opsGate.code === 0,
        code: results.opsGate.code,
        stdout: results.opsGate.stdout,
        stderr: results.opsGate.stderr ?? ''
      },
      {
        label: 'collector_status',
        ok: true,
        code: 0,
        stdout: results.collectorStatus.stdout,
        stderr: results.collectorStatus.stderr ?? ''
      },
      {
        label: 'fast_cap_inspect',
        ok: true,
        code: 0,
        stdout: results.fastCapInspect.stdout,
        stderr: results.fastCapInspect.stderr ?? ''
      },
      {
        label: 'delivery_failures',
        ok: true,
        code: 0,
        stdout: results.deliveryFailures.stdout,
        stderr: results.deliveryFailures.stderr ?? ''
      }
    ]
  };
}
