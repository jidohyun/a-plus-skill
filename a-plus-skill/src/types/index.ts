export type Policy = 'strict' | 'balanced' | 'fast';

export type SkillMeta = {
  slug: string;
  name: string;
  author: string;
  downloads: number;
  installsCurrent: number;
  stars: number;
  versions: number;
  summary: string;
  securityScanStatus: 'benign' | 'suspicious' | 'unknown';
  securityConfidence: 'low' | 'medium' | 'high';
  updatedAt: string;
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
