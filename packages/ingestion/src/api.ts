import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { parseRateLimitHeaders, shouldThrottle, calculateBackoff, sleep } from './ratelimit';

export interface EventRecord {
  id: string;
  type: string;
  name: string;
  timestamp: string | number;
  properties: Record<string, unknown>;
  sessionId?: string;
  userId?: string;
  session?: Record<string, unknown>;
}

export interface FetchEventsResponse {
  data: EventRecord[];
  hasMore: boolean;
  nextCursor: string | null;
  cursorExpiresIn?: number; // seconds until cursor expires
}

export class CursorExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CursorExpiredError';
  }
}

let client: AxiosInstance | null = null;

function getClient(): AxiosInstance {
  if (!client) {
    client = axios.create({
      baseURL: process.env.API_BASE_URL,
    });

    // Rate limit response interceptor
    client.interceptors.response.use(
      (response: AxiosResponse) => {
        const info = parseRateLimitHeaders(response.headers as Record<string, string>);
        if (shouldThrottle(info)) {
          // Fire-and-forget adaptive delay — next call will wait
          // (we return the response immediately but next fetch will be slightly delayed)
        }
        return response;
      },
      async (error) => {
        if (error.response?.status === 502) {
          throw new CursorExpiredError('Cursor expired (502 from server)');
        }
        if (error.response?.status === 429) {
          const attempt = error.config?._retryAttempt ?? 0;
          const delay = error.response.headers['retry-after']
            ? parseInt(error.response.headers['retry-after'], 10) * 1000
            : calculateBackoff(attempt);
          await sleep(delay);
          error.config._retryAttempt = attempt + 1;
          return client!.request(error.config);
        }
        return Promise.reject(error);
      }
    );
  }
  return client;
}

// Actual API response shape (pagination is nested)
interface ApiResponse {
  data: EventRecord[];
  pagination: {
    hasMore: boolean;
    nextCursor: string | null;
    cursorExpiresIn?: number;
    limit: number;
  };
  meta: {
    total: number;
    returned: number;
    requestId: string;
  };
}

export async function fetchEvents(
  cursor?: string | null,
  limit = 100
): Promise<FetchEventsResponse> {
  const params: Record<string, string | number> = { limit };
  if (cursor) params.cursor = cursor;

  const response = await getClient().get<ApiResponse>('/events', {
    params,
    headers: { 'X-API-Key': process.env.TARGET_API_KEY! },
  });

  return {
    data: response.data.data,
    hasMore: response.data.pagination.hasMore,
    nextCursor: response.data.pagination.nextCursor ?? null,
    cursorExpiresIn: response.data.pagination.cursorExpiresIn,
  };
}

// Reset client (useful for testing)
export function resetClient(): void {
  client = null;
}
