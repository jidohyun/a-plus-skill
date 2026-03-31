import type { Policy, ProfileConfig, RecommendationResult } from '../../types/index.js';
import { runRecommendationBatch } from './runRecommendationBatch.js';

export type RecommendationReportResult = {
  policy: Policy;
  profileType: ProfileConfig['type'];
  source: 'live' | 'fallback';
  degraded: boolean;
  fallbackReason?: string;
  fetchedAt: string;
  results: RecommendationResult[];
  report: string;
};

export async function getRecommendationReport(): Promise<RecommendationReportResult> {
  const batch = await runRecommendationBatch({ install: false, deliver: false });

  return {
    policy: batch.policy,
    profileType: batch.profile.type,
    source: batch.meta.source,
    degraded: batch.meta.degraded,
    fallbackReason: batch.meta.fallbackReason,
    fetchedAt: batch.meta.fetchedAt,
    results: batch.results,
    report: batch.report
  };
}
