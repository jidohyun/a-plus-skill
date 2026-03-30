import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_CLAWHUB_FETCH_TIMEOUT_MS,
  DEFAULT_MIN_PARSED_SKILLS,
  MAX_CLAWHUB_HTML_BYTES,
  MAX_MIN_PARSED_SKILLS,
  fetchCandidateSkills,
  MOCK_SKILLS,
  parseSkillsFromHtml,
  resolveClawhubFetchTimeoutMs
} from '../src/collector/clawhubClient.js';

const DEFAULT_CLAWHUB_SKILLS_URL = 'https://clawhub.ai/skills?nonSuspicious=true';

function withEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

afterEach(() => {
  delete process.env.CLAWHUB_BASE_URL;
  delete process.env.MIN_PARSED_SKILLS;
  delete process.env.CLAWHUB_FETCH_TIMEOUT_MS;
});

describe('collector', () => {
  it('resolves collector fetch timeout with bounds', () => {
    expect(resolveClawhubFetchTimeoutMs(undefined)).toBe(DEFAULT_CLAWHUB_FETCH_TIMEOUT_MS);
    expect(resolveClawhubFetchTimeoutMs('abc')).toBe(DEFAULT_CLAWHUB_FETCH_TIMEOUT_MS);
    expect(resolveClawhubFetchTimeoutMs('500')).toBe(1000);
    expect(resolveClawhubFetchTimeoutMs('999999')).toBe(60000);
    expect(resolveClawhubFetchTimeoutMs('2500')).toBe(2500);
  });

  it('parses skill list from embedded JSON script (including numeric strings)', () => {
    const html = `
      <html><body>
        <script id="__NEXT_DATA__" type="application/json">
          {
            "props": {
              "pageProps": {
                "skills": [
                  {
                    "slug": "demo/weather",
                    "name": "Weather",
                    "author": "demo",
                    "downloads": "1,200",
                    "installsCurrent": "22",
                    "stars": "15",
                    "versions": 2,
                    "description": "Forecast helper"
                  }
                ]
              }
            }
          }
        </script>
      </body></html>
    `;

    const skills = parseSkillsFromHtml(html);
    expect(skills).toHaveLength(1);
    expect(skills[0]?.slug).toBe('demo/weather');
    expect(skills[0]?.downloads).toBe(1200);
    expect(skills[0]?.installsCurrent).toBe(22);
  });

  it('falls back with metadata on fetch failure', async () => {
    const failingFetch: typeof fetch = async () => {
      throw new Error('network down');
    };

    const result = await fetchCandidateSkills(failingFetch);
    expect(result.skills).toEqual(MOCK_SKILLS);
    expect(result.skills).not.toBe(MOCK_SKILLS);
    expect(result.meta.degraded).toBe(true);
    expect(result.meta.source).toBe('fallback');
    expect(result.meta.fallbackReason).toContain('FETCH_ERROR');
  });

  it('falls back with timeout metadata when fetch aborts', async () => {
    const abortingFetch: typeof fetch = async (_input, init) => {
      const signal = init?.signal;
      await new Promise((_, reject) => {
        if (signal) {
          if (signal.aborted) {
            reject(signal.reason ?? new Error('aborted'));
            return;
          }
          signal.addEventListener(
            'abort',
            () => reject(signal.reason ?? new Error('aborted')),
            { once: true }
          );
        }
      });
      throw new Error('unreachable');
    };

    withEnv('CLAWHUB_FETCH_TIMEOUT_MS', '1000');
    const result = await fetchCandidateSkills(abortingFetch);
    expect(result.meta.source).toBe('fallback');
    expect(result.meta.degraded).toBe(true);
    expect(result.meta.fallbackReason).toBe('FETCH_ERROR_TIMEOUT');
  });

  it('uses default URL when CLAWHUB_BASE_URL host is disallowed', async () => {
    withEnv('CLAWHUB_BASE_URL', 'https://evil.example.com/skills?nonSuspicious=true');

    let requestedUrl = '';
    const okFetch: typeof fetch = async (input) => {
      requestedUrl = String(input);
      return new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } });
    };

    await fetchCandidateSkills(okFetch);
    expect(requestedUrl).toBe(DEFAULT_CLAWHUB_SKILLS_URL);
  });

  it('uses default URL when CLAWHUB_BASE_URL path is invalid', async () => {
    withEnv('CLAWHUB_BASE_URL', 'https://clawhub.ai/not-skills');

    let requestedUrl = '';
    const okFetch: typeof fetch = async (input) => {
      requestedUrl = String(input);
      return new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } });
    };

    await fetchCandidateSkills(okFetch);
    expect(requestedUrl).toBe(DEFAULT_CLAWHUB_SKILLS_URL);
  });

  it('uses user URL when CLAWHUB_BASE_URL host/path are valid', async () => {
    const customUrl = 'https://clawhub.org/skills?nonSuspicious=true&page=2';
    withEnv('CLAWHUB_BASE_URL', customUrl);

    let requestedUrl = '';
    const okFetch: typeof fetch = async (input) => {
      requestedUrl = String(input);
      return new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } });
    };

    await fetchCandidateSkills(okFetch);
    expect(requestedUrl).toBe(customUrl);
  });

  it('uses default URL when CLAWHUB_BASE_URL protocol is not https', async () => {
    withEnv('CLAWHUB_BASE_URL', 'http://clawhub.ai/skills?nonSuspicious=true');

    let requestedUrl = '';
    const okFetch: typeof fetch = async (input) => {
      requestedUrl = String(input);
      return new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } });
    };

    await fetchCandidateSkills(okFetch);
    expect(requestedUrl).toBe(DEFAULT_CLAWHUB_SKILLS_URL);
  });

  it('uses MIN_PARSED_SKILLS env: 1 keeps live, 5 triggers fallback', async () => {
    const oneSkillHtml = `<html><body><script>{"skills":[{"slug":"one/skill","name":"one","downloads":10}]}</script></body></html>`;
    const okFetch: typeof fetch = async () =>
      new Response(oneSkillHtml, { status: 200, headers: { 'content-type': 'text/html' } });

    withEnv('MIN_PARSED_SKILLS', '1');
    const liveResult = await fetchCandidateSkills(okFetch);
    expect(liveResult.meta.source).toBe('live');
    expect(liveResult.meta.degraded).toBe(false);

    withEnv('MIN_PARSED_SKILLS', '5');
    const fallbackResult = await fetchCandidateSkills(okFetch);
    expect(fallbackResult.meta.source).toBe('fallback');
    expect(fallbackResult.meta.degraded).toBe(true);
    expect(fallbackResult.meta.fallbackReason).toContain('PARSE_BELOW_THRESHOLD_1');
  });

  it('falls back when ClawHub returns unexpected content-type', async () => {
    const jsonFetch: typeof fetch = async () =>
      new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } });

    const result = await fetchCandidateSkills(jsonFetch);
    expect(result.meta.source).toBe('fallback');
    expect(result.meta.degraded).toBe(true);
    expect(result.meta.fallbackReason).toBe('UNEXPECTED_CONTENT_TYPE');
  });

  it('falls back when content-length exceeds collector HTML limit', async () => {
    const largeFetch: typeof fetch = async () =>
      new Response('<html></html>', {
        status: 200,
        headers: {
          'content-type': 'text/html',
          'content-length': String(MAX_CLAWHUB_HTML_BYTES + 1)
        }
      });

    const result = await fetchCandidateSkills(largeFetch);
    expect(result.meta.source).toBe('fallback');
    expect(result.meta.degraded).toBe(true);
    expect(result.meta.fallbackReason).toBe('HTML_TOO_LARGE');
  });

  it('falls back when HTML body exceeds collector limit after read', async () => {
    const hugeHtml = 'x'.repeat(MAX_CLAWHUB_HTML_BYTES + 1);
    const largeBodyFetch: typeof fetch = async () =>
      new Response(hugeHtml, {
        status: 200,
        headers: { 'content-type': 'text/html' }
      });

    const result = await fetchCandidateSkills(largeBodyFetch);
    expect(result.meta.source).toBe('fallback');
    expect(result.meta.degraded).toBe(true);
    expect(result.meta.fallbackReason).toBe('HTML_TOO_LARGE');
  });

  it('falls back when ClawHub returns empty or whitespace HTML', async () => {
    const emptyFetch: typeof fetch = async () =>
      new Response('   \n\t  ', {
        status: 200,
        headers: { 'content-type': 'text/html' }
      });

    const result = await fetchCandidateSkills(emptyFetch);
    expect(result.meta.source).toBe('fallback');
    expect(result.meta.degraded).toBe(true);
    expect(result.meta.fallbackReason).toBe('EMPTY_HTML');
  });

  it('falls back to default MIN_PARSED_SKILLS for invalid env values', async () => {
    const twoSkillsHtml = `
      <html><body><script>{"skills":[
        {"slug":"one/skill","name":"one","downloads":10},
        {"slug":"two/skill","name":"two","downloads":20}
      ]}</script></body></html>
    `;
    const okFetch: typeof fetch = async () =>
      new Response(twoSkillsHtml, { status: 200, headers: { 'content-type': 'text/html' } });

    withEnv('MIN_PARSED_SKILLS', 'abc');
    const result = await fetchCandidateSkills(okFetch);

    expect(DEFAULT_MIN_PARSED_SKILLS).toBe(3);
    expect(result.meta.source).toBe('fallback');
    expect(result.meta.fallbackReason).toContain('PARSE_BELOW_THRESHOLD_2');
  });

  it('clamps overly large MIN_PARSED_SKILLS to MAX_MIN_PARSED_SKILLS', async () => {
    const oneSkillHtml = `<html><body><script>{"skills":[{"slug":"one/skill","name":"one","downloads":10}]}</script></body></html>`;
    const okFetch: typeof fetch = async () =>
      new Response(oneSkillHtml, { status: 200, headers: { 'content-type': 'text/html' } });

    withEnv('MIN_PARSED_SKILLS', '9999');
    const result = await fetchCandidateSkills(okFetch);

    expect(MAX_MIN_PARSED_SKILLS).toBe(50);
    expect(result.meta.source).toBe('fallback');
    expect(result.meta.fallbackReason).toContain('PARSE_BELOW_THRESHOLD_1');
  });
});
