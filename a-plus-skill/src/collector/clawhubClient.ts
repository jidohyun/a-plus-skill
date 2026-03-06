import type { SkillMeta } from '../types/index.js';

/**
 * MVP mock collector.
 * TODO: replace with real ClawHub API/html parser.
 */
export async function fetchCandidateSkills(): Promise<SkillMeta[]> {
  return [
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
}
