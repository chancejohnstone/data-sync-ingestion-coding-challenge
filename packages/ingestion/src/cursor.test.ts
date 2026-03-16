import { describe, it, expect } from 'vitest';
import { isCursorStale } from './cursor';

describe('isCursorStale', () => {
  it('returns false when cursor is fresh', () => {
    const refreshedAt = new Date(Date.now() - 30_000); // 30s ago
    expect(isCursorStale(refreshedAt, 60)).toBe(false);
  });

  it('returns true when cursor age exceeds threshold', () => {
    const refreshedAt = new Date(Date.now() - 90_000); // 90s ago
    expect(isCursorStale(refreshedAt, 60)).toBe(true);
  });

  it('returns true when cursor age exactly equals threshold', () => {
    const refreshedAt = new Date(Date.now() - 60_000); // exactly 60s ago
    expect(isCursorStale(refreshedAt, 60)).toBe(true);
  });

  it('returns true when refreshedAt is null (no cursor set yet)', () => {
    expect(isCursorStale(null, 60)).toBe(true);
  });

  it('uses default threshold of 60s when not specified', () => {
    const refreshedAt = new Date(Date.now() - 61_000);
    expect(isCursorStale(refreshedAt)).toBe(true);
  });
});
