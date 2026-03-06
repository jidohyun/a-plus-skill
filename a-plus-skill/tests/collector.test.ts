import { describe, expect, it } from 'vitest';
import { fetchCandidateSkills, MOCK_SKILLS, parseSkillsFromHtml } from '../src/collector/clawhubClient.js';

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

  it('falls back when parsed skill count is below threshold', async () => {
    const html = `<html><body><script>{"skills":[{"slug":"one/skill","name":"one","downloads":10}]}</script></body></html>`;
    const okFetch: typeof fetch = async () =>
      new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });

    const result = await fetchCandidateSkills(okFetch);
    expect(result.meta.degraded).toBe(true);
    expect(result.meta.fallbackReason).toContain('PARSE_BELOW_THRESHOLD');
  });
});
