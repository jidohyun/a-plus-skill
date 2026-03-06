import { describe, expect, it } from 'vitest';
import { fetchCandidateSkills, MOCK_SKILLS, parseSkillsFromHtml } from '../src/collector/clawhubClient.js';

describe('collector', () => {
  it('parses skill list from embedded JSON script', () => {
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
                    "downloads": 1200,
                    "installsCurrent": 22,
                    "stars": 15,
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
  });

  it('falls back to mock data on fetch failure', async () => {
    const failingFetch: typeof fetch = async () => {
      throw new Error('network down');
    };

    const skills = await fetchCandidateSkills(failingFetch);
    expect(skills).toEqual(MOCK_SKILLS);
  });
});
