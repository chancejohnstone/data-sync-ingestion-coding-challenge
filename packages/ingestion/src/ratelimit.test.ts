import { describe, it, expect } from 'vitest';
import { parseRateLimitHeaders, shouldThrottle, calculateBackoff } from './ratelimit';

describe('parseRateLimitHeaders', () => {
  it('parses all rate limit headers', () => {
    const headers = {
      'x-ratelimit-limit': '100',
      'x-ratelimit-remaining': '50',
      'x-ratelimit-reset': '1705315900',
      'retry-after': '5',
    };
    const result = parseRateLimitHeaders(headers);
    expect(result.limit).toBe(100);
    expect(result.remaining).toBe(50);
    expect(result.reset).toBe(1705315900);
    expect(result.retryAfter).toBe(5);
  });

  it('returns null for missing headers', () => {
    const result = parseRateLimitHeaders({});
    expect(result.limit).toBeNull();
    expect(result.remaining).toBeNull();
  });
});

describe('shouldThrottle', () => {
  it('returns true when remaining < 10', () => {
    expect(shouldThrottle({ limit: 100, remaining: 5, reset: null, retryAfter: null })).toBe(true);
  });

  it('returns false when remaining >= 10', () => {
    expect(shouldThrottle({ limit: 100, remaining: 10, reset: null, retryAfter: null })).toBe(false);
  });
});

describe('calculateBackoff', () => {
  it('doubles delay each attempt, starting at 1s', () => {
    expect(calculateBackoff(0)).toBe(1000);
    expect(calculateBackoff(1)).toBe(2000);
    expect(calculateBackoff(2)).toBe(4000);
  });

  it('caps at 30 seconds', () => {
    expect(calculateBackoff(10)).toBe(30000);
  });
});
