import type { ProfileConfig, SkillMeta } from '../types/index.js';

const clampScore = (value: number) => Math.max(0, Math.min(100, value));
const roundScore = (value: number) => Math.round(value * 1_000_000) / 1_000_000;

const toFiniteNumber = (value: number | undefined, fallback: number) =>
  Number.isFinite(value) ? (value as number) : fallback;

const lower = (value: string | undefined) => (typeof value === 'string' ? value.toLowerCase() : '');

export function calculateFitScore(skill: SkillMeta, profile: ProfileConfig): number {
  const text = `${lower(skill.slug)} ${lower(skill.name)} ${lower(skill.summary)}`;
  const focusKeywords = (profile.focusKeywords ?? []).map((k) => k.toLowerCase());
  const avoidKeywords = (profile.avoidKeywords ?? []).map((k) => k.toLowerCase());
  const preferredAuthors = (profile.preferredAuthors ?? []).map((a) => a.toLowerCase());

  const focusHits = focusKeywords.reduce((acc, keyword) => (keyword && text.includes(keyword) ? acc + 1 : acc), 0);
  const avoidHits = avoidKeywords.reduce((acc, keyword) => (keyword && text.includes(keyword) ? acc + 1 : acc), 0);

  const focusRatio = focusKeywords.length > 0 ? focusHits / focusKeywords.length : 0;
  const avoidRatio = avoidKeywords.length > 0 ? avoidHits / avoidKeywords.length : 0;
  const authorBonus = preferredAuthors.includes(lower(skill.author)) ? 12 : 0;
  const summaryPenalty = lower(skill.summary).length === 0 ? 8 : 0;

  const base = 50;
  const rawScore = base + focusRatio * 38 - avoidRatio * 28 + authorBonus - summaryPenalty;
  return clampScore(rawScore);
}

export function calculateTrendScore(skill: SkillMeta): number {
  const downloads = Math.max(0, toFiniteNumber(skill.downloads, 0));
  const stars = Math.max(0, toFiniteNumber(skill.stars, 0));
  const installsCurrent = Math.max(0, toFiniteNumber(skill.installsCurrent, 0));

  const downloadsSignal = clampScore((Math.log10(downloads + 1) / 6) * 100);
  const starsSignal = clampScore((Math.log10(stars + 1) / 4) * 100);
  const installSignal = clampScore((Math.log10(installsCurrent + 1) / 5) * 100);

  return clampScore(downloadsSignal * 0.4 + starsSignal * 0.25 + installSignal * 0.35);
}

export function calculateStabilityScore(skill: SkillMeta, nowMs: number = Date.now()): number {
  const versions = Math.max(0, toFiniteNumber(skill.versions, 0));
  const updatedAt = Date.parse(skill.updatedAt);

  const versionsSignal = clampScore((1 - Math.exp(-versions / 12)) * 100);

  let recencySignal = 50;
  if (Number.isFinite(updatedAt)) {
    const ageMs = Math.max(0, nowMs - updatedAt);
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    recencySignal = clampScore(100 * Math.exp(-ageDays / 365));
  }

  return roundScore(clampScore(versionsSignal * 0.6 + recencySignal * 0.4));
}

export function calculateFinalScore(input: {
  fit: number;
  trend: number;
  stability: number;
  security: number;
}) {
  const { fit, trend, stability, security } = input;
  return clampScore(0.35 * fit + 0.2 * trend + 0.15 * stability + 0.3 * security);
}
