import { fetchCandidateSkills, resolveClawhubFetchTimeoutMs, resolveMinParsedSkills } from '../src/collector/clawhubClient.ts';

const strict = process.argv.includes('--strict') || process.env.COLLECTOR_STATUS_STRICT === 'true';

const result = await fetchCandidateSkills();
const mode = result.meta.source;
const reason = mode === 'live' ? 'NONE' : result.meta.fallbackReason ?? 'UNKNOWN';
const threshold = resolveMinParsedSkills();
const skillCount = result.skills.length;
const degraded = result.meta.degraded;
const fetchTimeoutMs = resolveClawhubFetchTimeoutMs();

console.log(
  `collector_status mode=${mode} degraded=${degraded} reason=${reason} threshold=${threshold} skillCount=${skillCount} fetchTimeoutMs=${fetchTimeoutMs} fetchedAt=${result.meta.fetchedAt}`
);

if (strict && mode === 'fallback') {
  process.exit(2);
}
