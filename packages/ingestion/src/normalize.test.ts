import { describe, it, expect } from 'vitest';
import { normalizeTimestamp } from './normalize';

describe('normalizeTimestamp', () => {
  it('passes through ISO 8601 UTC unchanged', () => {
    const ts = '2024-01-15T10:30:00.000Z';
    expect(normalizeTimestamp(ts)).toBe(ts);
  });

  it('converts ISO with positive offset to UTC', () => {
    const result = normalizeTimestamp('2024-01-15T15:30:00.000+05:00');
    expect(result).toBe('2024-01-15T10:30:00.000Z');
  });

  it('converts ISO with negative offset to UTC', () => {
    const result = normalizeTimestamp('2024-01-15T05:30:00.000-05:00');
    expect(result).toBe('2024-01-15T10:30:00.000Z');
  });

  it('converts Unix seconds (10 digits) to ISO UTC', () => {
    // 1705314600 = 2024-01-15T10:30:00.000Z
    const result = normalizeTimestamp(1705314600);
    expect(result).toBe('2024-01-15T10:30:00.000Z');
  });

  it('converts Unix milliseconds (13 digits) to ISO UTC', () => {
    // 1705314600000 = 2024-01-15T10:30:00.000Z
    const result = normalizeTimestamp(1705314600000);
    expect(result).toBe('2024-01-15T10:30:00.000Z');
  });

  it('throws descriptive error for unknown string format', () => {
    expect(() => normalizeTimestamp('not-a-date')).toThrow(/unknown timestamp format/i);
  });

  it('throws descriptive error for unknown numeric format', () => {
    // A number that is neither 10-digit seconds nor 13-digit milliseconds
    expect(() => normalizeTimestamp(12345)).toThrow(/unknown timestamp format/i);
  });
});
