import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_MIN_PARSED_SKILLS,
  fetchCandidateSkills,
  MOCK_SKILLS,
  parseSkillsFromHtml
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
});

describe('collector', () => {
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
});
