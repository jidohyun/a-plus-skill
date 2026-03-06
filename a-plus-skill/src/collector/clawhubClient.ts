import type { SkillMeta } from '../types/index.js';

const CLAWHUB_SKILLS_URL = 'https://clawhub.org/skills?nonSuspicious=true';

type FetchLike = typeof fetch;

const MOCK_SKILLS: SkillMeta[] = [
  {
    slug: 'steipete/weather',
    name: 'Weather',
    author: 'steipete',
    downloads: 59600,
    installsCurrent: 350,
    stars: 209,
    versions: 1,
    summary: 'Get current weather and forecasts.',
    securityScanStatus: 'benign',
    securityConfidence: 'medium',
    updatedAt: new Date().toISOString()
  },
  {
    slug: 'halthelobster/proactive-agent',
    name: 'Proactive Agent',
    author: 'halthelobster',
    downloads: 57600,
    installsCurrent: 519,
    stars: 382,
    versions: 11,
    summary: 'Proactive automation patterns and memory ops.',
    securityScanStatus: 'suspicious',
    securityConfidence: 'medium',
    updatedAt: new Date().toISOString()
  }
];

function asNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/,/g, ''));
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function extractJsonCandidatesFromHtml(html: string): unknown[] {
  const candidates: unknown[] = [];
  const scripts = html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi);

  for (const script of scripts) {
    const content = script[1]?.trim();
    if (!content) continue;

    if (content.startsWith('{') || content.startsWith('[')) {
      try {
        candidates.push(JSON.parse(content));
      } catch {
        // ignore malformed JSON blob
      }
    }

    const escapedState = content.match(/__NEXT_DATA__\s*=\s*(\{[\s\S]*\});?/);
    if (escapedState?.[1]) {
      try {
        candidates.push(JSON.parse(escapedState[1]));
      } catch {
        // ignore malformed JSON blob
      }
    }
  }

  return candidates;
}

function findSkillLikeItems(node: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(node)) {
    for (const item of node) findSkillLikeItems(item, out);
    return out;
  }

  if (!node || typeof node !== 'object') return out;

  const rec = node as Record<string, unknown>;
  const hasIdentity = typeof rec.slug === 'string' || typeof rec.name === 'string';
  const hasSignals =
    typeof rec.downloads === 'number' ||
    typeof rec.stars === 'number' ||
    typeof rec.installsCurrent === 'number' ||
    typeof rec.installCount === 'number';

  if (hasIdentity && hasSignals) out.push(rec);

  for (const value of Object.values(rec)) {
    findSkillLikeItems(value, out);
  }

  return out;
}

function normalizeSkill(raw: Record<string, unknown>): SkillMeta | null {
  const rawSlug = raw.slug ?? raw.id ?? raw.identifier;
  const slug = typeof rawSlug === 'string' ? rawSlug.trim() : '';
  if (!slug) return null;

  const nameValue = raw.name ?? raw.title;
  const name = typeof nameValue === 'string' && nameValue.trim() ? nameValue.trim() : slug.split('/').pop() ?? slug;

  const authorValue = raw.author ?? raw.owner ?? raw.publisher;
  const author =
    typeof authorValue === 'string' && authorValue.trim()
      ? authorValue.trim()
      : slug.includes('/')
        ? slug.split('/')[0]
        : 'unknown';

  const summaryValue = raw.summary ?? raw.description ?? raw.desc;
  const summary = typeof summaryValue === 'string' ? summaryValue.trim() : '';

  const securityStatusValue = raw.securityScanStatus ?? raw.scanStatus ?? raw.securityStatus;
  const securityScanStatus: SkillMeta['securityScanStatus'] =
    securityStatusValue === 'benign' || securityStatusValue === 'suspicious' ? securityStatusValue : 'unknown';

  const securityConfidenceValue = raw.securityConfidence ?? raw.scanConfidence;
  const securityConfidence: SkillMeta['securityConfidence'] =
    securityConfidenceValue === 'low' || securityConfidenceValue === 'medium' || securityConfidenceValue === 'high'
      ? securityConfidenceValue
      : 'low';

  const updatedRaw = raw.updatedAt ?? raw.updated_at ?? raw.lastUpdated;
  const updatedAt = typeof updatedRaw === 'string' && !Number.isNaN(Date.parse(updatedRaw))
    ? new Date(updatedRaw).toISOString()
    : new Date().toISOString();

  return {
    slug,
    name,
    author,
    downloads: asNumber(raw.downloads ?? raw.downloadCount),
    installsCurrent: asNumber(raw.installsCurrent ?? raw.installCount ?? raw.activeInstalls),
    stars: asNumber(raw.stars ?? raw.starCount),
    versions: asNumber(raw.versions ?? raw.versionCount),
    summary,
    securityScanStatus,
    securityConfidence,
    updatedAt
  };
}

export function parseSkillsFromHtml(html: string): SkillMeta[] {
  const candidates = extractJsonCandidatesFromHtml(html);
  const mapped = candidates
    .flatMap((candidate) => findSkillLikeItems(candidate))
    .map((raw) => normalizeSkill(raw))
    .filter((skill): skill is SkillMeta => Boolean(skill));

  const deduped = new Map<string, SkillMeta>();
  for (const skill of mapped) {
    if (!deduped.has(skill.slug)) deduped.set(skill.slug, skill);
  }

  return [...deduped.values()];
}

export async function fetchCandidateSkills(fetcher: FetchLike = fetch): Promise<SkillMeta[]> {
  try {
    const response = await fetcher(CLAWHUB_SKILLS_URL, {
      headers: {
        'user-agent': 'a-plus-skill/0.1',
        accept: 'text/html,application/xhtml+xml'
      }
    });

    if (!response.ok) {
      console.warn(`[collector] ClawHub request failed: ${response.status} ${response.statusText}`);
      return MOCK_SKILLS;
    }

    const html = await response.text();
    const parsed = parseSkillsFromHtml(html);

    if (parsed.length === 0) {
      console.warn('[collector] ClawHub parse yielded no skills; falling back to mock data.');
      return MOCK_SKILLS;
    }

    return parsed;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`[collector] ClawHub fetch failed (${reason}); falling back to mock data.`);
    return MOCK_SKILLS;
  }
}

export { MOCK_SKILLS };
