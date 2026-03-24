export interface RateLimitInfo {
  limit: number | null;
  remaining: number | null;
  reset: number | null;
  retryAfter: number | null;
}

export function parseRateLimitHeaders(headers: Record<string, string>): RateLimitInfo {
  const get = (key: string): number | null => {
    const v = headers[key] ?? headers[key.toLowerCase()];
    return v != null ? parseInt(v, 10) : null;
  };
  return {
    limit: get('x-ratelimit-limit'),
    remaining: get('x-ratelimit-remaining'),
    reset: get('x-ratelimit-reset'),
    retryAfter: get('retry-after'),
  };
}

export function shouldThrottle(info: RateLimitInfo): boolean {
  return info.remaining !== null && info.remaining <= 1;
}

export function calculateBackoff(attempt: number): number {
  return Math.min(1000 * Math.pow(2, attempt), 30000);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
