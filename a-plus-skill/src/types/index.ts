export type Policy = 'strict' | 'balanced' | 'fast';

export type ProfileType = 'developer' | 'automation' | 'assistant';

export type ProfileConfig = {
  type: ProfileType;
  focusKeywords: string[];
  avoidKeywords: string[];
  preferredAuthors: string[];
};

export type ProfileRegistry = {
  defaultProfile: ProfileType;
  profiles: Record<ProfileType, Omit<ProfileConfig, 'type'>>;
};

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

export type InstallAction = 'auto-install' | 'override-install' | 'confirm-install' | 'skip-install';

export type InstallPolicyContext = {
  degraded?: boolean;
  confirmed?: boolean;
  overrideToken?: string;
  strongOverrideToken?: string;
  overrideReason?: string;
};

export type InstallPlan = {
  policy: Policy;
  originalDecision: RecommendationResult['decision'];
  effectiveDecision: RecommendationResult['decision'];
  action: InstallAction;
  canInstall: boolean;
  notes: string[];
};

export type InstallOutcome = {
  slug: string;
  action: InstallAction;
  attempted: boolean;
  installed: boolean;
  status: 'installed' | 'skipped' | 'failed';
  command?: string;
  code?: number | null;
  stdout?: string;
  stderr?: string;
  error?: string;
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
  installAction?: InstallAction;
  installOutcome?: InstallOutcome;
};

export type CollectorMeta = {
  source: 'live' | 'fallback';
  degraded: boolean;
  fallbackReason?: string;
  fetchedAt: string;
};

export type CollectorResult = {
  skills: SkillMeta[];
  meta: CollectorMeta;
};

export type ReportDeliveryMode = 'none' | 'discord-dm' | 'telegram';

export type ReportDeliveryResult = {
  skipped: boolean;
  mode: ReportDeliveryMode;
  success?: boolean;
  reason?: string;
  chunksAttempted: number;
  chunksSent: number;
};
