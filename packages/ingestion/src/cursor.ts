const DEFAULT_THRESHOLD_SECONDS = 60;

export function isCursorStale(
  refreshedAt: Date | null,
  thresholdSeconds = DEFAULT_THRESHOLD_SECONDS
): boolean {
  if (refreshedAt === null) return true;
  const ageMs = Date.now() - refreshedAt.getTime();
  return ageMs >= thresholdSeconds * 1000;
}

export function getCursorThreshold(): number {
  const env = process.env.CURSOR_REFRESH_THRESHOLD;
  return env ? parseInt(env, 10) : DEFAULT_THRESHOLD_SECONDS;
}
