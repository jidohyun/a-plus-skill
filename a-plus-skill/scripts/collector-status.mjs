import { fetchCandidateSkills, resolveMinParsedSkills } from '../src/collector/clawhubClient.ts';

const strict = process.argv.includes('--strict') || process.env.COLLECTOR_STATUS_STRICT === 'true';

const result = await fetchCandidateSkills();
const mode = result.meta.source;
const reason = mode === 'live' ? 'NONE' : result.meta.fallbackReason ?? 'UNKNOWN';
const threshold = resolveMinParsedSkills();

console.log(`collector_status mode=${mode} reason=${reason} threshold=${threshold} fetchedAt=${result.meta.fetchedAt}`);

if (strict && mode === 'fallback') {
  process.exit(2);
}
