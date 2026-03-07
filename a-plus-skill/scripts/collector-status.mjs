import { fetchCandidateSkills } from '../src/collector/clawhubClient.ts';

const result = await fetchCandidateSkills();
const mode = result.meta.source;
const reason = mode === 'live' ? 'NONE' : result.meta.fallbackReason ?? 'UNKNOWN';

console.log(`mode=${mode} reason=${reason} fetchedAt=${result.meta.fetchedAt}`);
