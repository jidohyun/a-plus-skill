export function calculateFinalScore(input: {
  fit: number;
  trend: number;
  stability: number;
  security: number;
}) {
  const { fit, trend, stability, security } = input;
  return 0.35 * fit + 0.2 * trend + 0.15 * stability + 0.3 * security;
}
