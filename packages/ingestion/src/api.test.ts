import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';

vi.mock('axios');

describe('API client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.API_BASE_URL = 'http://test-api.example.com/api/v1';
    process.env.TARGET_API_KEY = 'test-key-123';
  });

  it('sends X-API-Key header on every request', async () => {
    const mockGet = vi.fn().mockResolvedValue({
      data: { data: [], pagination: { hasMore: false, nextCursor: null, limit: 100 }, meta: { total: 0, returned: 0, requestId: 'test' } },
      headers: {},
      status: 200,
    });
    (axios.create as ReturnType<typeof vi.fn>).mockReturnValue({
      get: mockGet,
      interceptors: { response: { use: vi.fn() } },
    });

    const { fetchEvents } = await import('./api');
    await fetchEvents();

    expect(mockGet).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-API-Key': 'test-key-123' }),
      })
    );
  });

  it('does NOT use query param for auth', async () => {
    const mockGet = vi.fn().mockResolvedValue({
      data: { data: [], pagination: { hasMore: false, nextCursor: null, limit: 100 }, meta: { total: 0, returned: 0, requestId: 'test' } },
      headers: {},
      status: 200,
    });
    (axios.create as ReturnType<typeof vi.fn>).mockReturnValue({
      get: mockGet,
      interceptors: { response: { use: vi.fn() } },
    });

    const { fetchEvents } = await import('./api');
    await fetchEvents();

    const callArgs = mockGet.mock.calls[0];
    const url: string = callArgs[0];
    expect(url).not.toContain('api_key');
    expect(url).not.toContain('apikey');
    expect(url).not.toContain('key=');
  });
});
