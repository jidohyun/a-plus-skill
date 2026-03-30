import type { CollectorResult, SkillMeta } from '../types/index.js';

const DEFAULT_CLAWHUB_SKILLS_URL = 'https://clawhub.ai/skills?nonSuspicious=true';
const ALLOWED_HOSTS = new Set(['clawhub.ai', 'www.clawhub.ai', 'clawhub.org', 'www.clawhub.org']);
export const DEFAULT_MIN_PARSED_SKILLS = 3;
export const MAX_MIN_PARSED_SKILLS = 50;
export const MAX_CLAWHUB_HTML_BYTES = 2 * 1024 * 1024;
export const DEFAULT_CLAWHUB_FETCH_TIMEOUT_MS = 10_000;

type FetchLike = typeof fetch;

type FetchOptions = Parameters<FetchLike>[1];

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

export function resolveClawhubFetchTimeoutMs(raw = process.env.CLAWHUB_FETCH_TIMEOUT_MS): number {
  const parsed = Number(raw);
  if (!raw || !Number.isFinite(parsed) || parsed <= 0) return DEFAULT_CLAWHUB_FETCH_TIMEOUT_MS;
  return Math.max(1_000, Math.min(60_000, Math.floor(parsed)));
}

function resolveSkillsUrl(): string {
  const raw = process.env.CLAWHUB_BASE_URL?.trim() || DEFAULT_CLAWHUB_SKILLS_URL;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return DEFAULT_CLAWHUB_SKILLS_URL;
  }

  if (parsed.protocol !== 'https:') {
    console.warn(`[collector] Disallowed ClawHub protocol: ${parsed.protocol}. Falling back to default URL.`);
    return DEFAULT_CLAWHUB_SKILLS_URL;
  }

  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    console.warn(`[collector] Disallowed ClawHub host: ${parsed.hostname}. Falling back to default host.`);
    return DEFAULT_CLAWHUB_SKILLS_URL;
  }

  const hasExpectedPath = parsed.pathname === '/skills' || parsed.pathname.startsWith('/skills/');
  if (!hasExpectedPath) {
    console.warn(`[collector] Unexpected ClawHub path: ${parsed.pathname}. Falling back to default skills URL.`);
    return DEFAULT_CLAWHUB_SKILLS_URL;
  }

  return parsed.toString();
}

export function resolveMinParsedSkills(): number {
  const raw = process.env.MIN_PARSED_SKILLS?.trim();
  if (!raw) return DEFAULT_MIN_PARSED_SKILLS;

  if (!/^[0-9]+$/.test(raw)) return DEFAULT_MIN_PARSED_SKILLS;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_MIN_PARSED_SKILLS;

  return Math.min(parsed, MAX_MIN_PARSED_SKILLS);
}

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
  const hasSignals = [
    'downloads',
    'downloadCount',
    'stars',
    'starCount',
    'installsCurrent',
    'installCount',
    'activeInstalls'
  ].some((key) => key in rec);

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
  const updatedAt =
    typeof updatedRaw === 'string' && !Number.isNaN(Date.parse(updatedRaw))
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

function cloneMockSkills(): SkillMeta[] {
  return MOCK_SKILLS.map((skill) => ({ ...skill }));
}

function fallbackResult(reason: string): CollectorResult {
  return {
    skills: cloneMockSkills(),
    meta: {
      source: 'fallback',
      degraded: true,
      fallbackReason: reason,
      fetchedAt: new Date().toISOString()
    }
  };
}

export async function fetchCandidateSkills(fetcher: FetchLike = fetch): Promise<CollectorResult> {
  const skillsUrl = resolveSkillsUrl();
  const minParsedSkills = resolveMinParsedSkills();
  const timeoutMs = resolveClawhubFetchTimeoutMs();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error(`collector timeout after ${timeoutMs}ms`)), timeoutMs);

    let response;
    try {
      const options: FetchOptions = {
        headers: {
          'user-agent': 'a-plus-skill/0.1',
          accept: 'text/html,application/xhtml+xml'
        },
        signal: controller.signal
      };
      response = await fetcher(skillsUrl, options);
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const reason = `HTTP_${response.status}`;
      console.warn(`[collector] ClawHub request failed: ${response.status} ${response.statusText}`);
      return fallbackResult(reason);
    }

    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    if (contentType && !contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
      const reason = 'UNEXPECTED_CONTENT_TYPE';
      console.warn(`[collector] ClawHub returned unexpected content-type: ${contentType}`);
      return fallbackResult(reason);
    }

    const contentLengthRaw = response.headers.get('content-length')?.trim() ?? '';
    if (/^[0-9]+$/.test(contentLengthRaw)) {
      const contentLength = Number.parseInt(contentLengthRaw, 10);
      if (Number.isFinite(contentLength) && contentLength > MAX_CLAWHUB_HTML_BYTES) {
        console.warn(`[collector] ClawHub response too large: ${contentLength} bytes (limit=${MAX_CLAWHUB_HTML_BYTES})`);
        return fallbackResult('HTML_TOO_LARGE');
      }
    }

    const html = await response.text();
    if (Buffer.byteLength(html, 'utf8') > MAX_CLAWHUB_HTML_BYTES) {
      console.warn(`[collector] ClawHub HTML body exceeded limit after read (limit=${MAX_CLAWHUB_HTML_BYTES})`);
      return fallbackResult('HTML_TOO_LARGE');
    }

    if (!html.trim()) {
      console.warn('[collector] ClawHub returned empty HTML body; falling back.');
      return fallbackResult('EMPTY_HTML');
    }

    const parsed = parseSkillsFromHtml(html);

    if (parsed.length < minParsedSkills) {
      const reason = `PARSE_BELOW_THRESHOLD_${parsed.length}`;
      console.warn(`[collector] ClawHub parse yielded ${parsed.length} skills (<${minParsedSkills}); falling back.`);
      return fallbackResult(reason);
    }

    return {
      skills: parsed,
      meta: {
        source: 'live',
        degraded: false,
        fetchedAt: new Date().toISOString()
      }
    };
  } catch (error) {
    const isAbort =
      (error instanceof Error && error.name === 'AbortError') ||
      (error instanceof Error && error.message.includes('collector timeout after'));
    const reasonCode = isAbort ? 'TIMEOUT' : error instanceof Error ? error.name || 'ERROR' : 'UNKNOWN';
    console.warn(`[collector] ClawHub fetch failed (${reasonCode}); falling back to mock data.`);
    return fallbackResult(`FETCH_ERROR_${reasonCode}`);
  }
}

export { MOCK_SKILLS };
