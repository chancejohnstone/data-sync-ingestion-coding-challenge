export function normalizeTimestamp(value: string | number): string {
  if (typeof value === 'number') {
    const digits = Math.abs(value).toString().replace('.', '').length;
    if (digits === 10) {
      return new Date(value * 1000).toISOString();
    } else if (digits >= 13) {
      return new Date(value).toISOString();
    }
    throw new Error(`Unknown timestamp format: numeric value ${value} (expected 10-digit seconds or 13-digit ms)`);
  }

  // String: try parsing as ISO
  const d = new Date(value);
  if (!isNaN(d.getTime())) {
    return d.toISOString();
  }

  throw new Error(`Unknown timestamp format: "${value}"`);
}
