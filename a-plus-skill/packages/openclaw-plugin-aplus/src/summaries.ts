import type { getInstallSummary } from '../../../dist/src/application/status/getInstallSummary.js';
import type { getMaintenanceStatus } from '../../../dist/src/application/status/getMaintenanceStatus.js';
import type { getScoringCalibration } from '../../../dist/src/application/status/getScoringCalibration.js';
import type { getRecommendationReport } from '../../../dist/src/application/recommend/getRecommendationReport.js';
import type { getAuditVerify } from '../../../dist/src/application/status/getAuditVerify.js';
import type { getInstallPlanReport } from '../../../dist/src/application/recommend/getInstallPlanReport.js';
import { summarizeTop } from './toolHelpers.js';

export function summarizeStatus(status: ReturnType<typeof getMaintenanceStatus> extends Promise<infer T> ? T : never): string {
  const summary = status.summary;
  return `aplus_status overall=${summary.overall} severity=${summary.severity} issue_count=${summary.issue_count} primary_issue=${summary.primary_issue} recommended_action=${JSON.stringify(summary.recommended_action)}`;
}

export function summarizeInstallSummary(summary: ReturnType<typeof getInstallSummary>): string {
  const actions = summarizeTop(summary.counters.actions.slice(0, 2).map((row) => `${row.key}:${row.count}`));
  const statuses = summarizeTop(summary.counters.statuses.slice(0, 2).map((row) => `${row.key}:${row.count}`));
  return `aplus_install_summary hours=${summary.summary.hours} records=${summary.summary.records} actions=${JSON.stringify(actions)} statuses=${JSON.stringify(statuses)}`;
}

export function summarizeScoringCalibration(calibration: Awaited<ReturnType<typeof getScoringCalibration>>): string {
  const counts = calibration.decision_counts;
  return `aplus_scoring_calibration policy=${calibration.summary.policy} source=${calibration.summary.source} degraded=${calibration.summary.degraded} sample_quality=${calibration.summary.sample_quality} decisions=${JSON.stringify(`recommend=${counts.recommend} caution=${counts.caution} hold=${counts.hold} block=${counts.block}`)}`;
}

export function summarizeRecommendationReport(report: Awaited<ReturnType<typeof getRecommendationReport>>): string {
  const top = summarizeTop(report.results.slice(0, 3).map((item) => `${item.slug}:${item.decision}:${item.finalScore.toFixed(1)}`));
  return `aplus_recommend_report policy=${report.policy} source=${report.source} degraded=${report.degraded} results=${report.results.length} top=${JSON.stringify(top)}`;
}

export function summarizeAuditVerify(result: ReturnType<typeof getAuditVerify>): string {
  return `aplus_audit_verify ok=${result.ok} line=${result.line} verifiedCount=${result.verifiedCount} path=${JSON.stringify(result.path)} reason=${JSON.stringify(result.reason)}`;
}

export function summarizeInstallPlanReport(plan: Awaited<ReturnType<typeof getInstallPlanReport>>): string {
  const top = summarizeTop(plan.items.slice(0, 3).map((item) => `${item.slug}:${item.installAction}:${item.decision}`));
  return `aplus_install_plan policy=${plan.policy} source=${plan.source} degraded=${plan.degraded} items=${plan.items.length} top=${JSON.stringify(top)}`;
}
