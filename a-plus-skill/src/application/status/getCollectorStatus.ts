import { fetchCandidateSkills, resolveClawhubFetchTimeoutMs, resolveMinParsedSkills } from '../../collector/clawhubClient.js';

export type CollectorStatusResult = {
  mode: string;
  degraded: boolean;
  reason: string;
  threshold: number;
  skillCount: number;
  skill_count: number;
  fetchTimeoutMs: number;
  fetch_timeout_ms: number;
  fetchedAt: string;
  fetched_at: string;
};

export async function getCollectorStatus(): Promise<CollectorStatusResult> {
  const result = await fetchCandidateSkills();
  const mode = result.meta.source;
  const reason = mode === 'live' ? 'NONE' : result.meta.fallbackReason ?? 'UNKNOWN';
  const threshold = resolveMinParsedSkills();
  const skillCount = result.skills.length;
  const fetchTimeoutMs = resolveClawhubFetchTimeoutMs();

  return {
    mode,
    degraded: result.meta.degraded,
    reason,
    threshold,
    skillCount,
    skill_count: skillCount,
    fetchTimeoutMs,
    fetch_timeout_ms: fetchTimeoutMs,
    fetchedAt: result.meta.fetchedAt,
    fetched_at: result.meta.fetchedAt
  };
}
