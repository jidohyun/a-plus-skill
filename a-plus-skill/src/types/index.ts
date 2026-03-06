export type Policy = 'strict' | 'balanced' | 'fast';

export type SkillMeta = {
  slug: string;
  name: string;
  downloads: number;
  stars: number;
  securityScanStatus: 'benign' | 'suspicious' | 'unknown';
};

export type RecommendationResult = {
  slug: string;
  fitScore: number;
  trendScore: number;
  stabilityScore: number;
  securityScore: number;
  finalScore: number;
  decision: 'recommend' | 'caution' | 'hold' | 'block';
  reasons: string[];
};
