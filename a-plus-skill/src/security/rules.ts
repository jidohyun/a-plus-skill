const DANGEROUS_PATTERNS = [
  /curl\s+.*\|\s*(bash|sh)/i,
  /wget\s+.*\|\s*(bash|sh)/i,
  /base64\s+-d\s+.*\|\s*(bash|sh)/i,
  /\bnpx\b.*\s-y\b/i
];

export function ruleRiskFromText(text: string): number {
  let score = 0;
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(text)) score += 25;
  }
  return Math.min(score, 100);
}
