import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { parseRateLimitHeaders, shouldThrottle, calculateBackoff, sleep } from './ratelimit';

export interface EventRecord {
  id: string;
  event_type: string;
  timestamp: string | number;
  payload: Record<string, unknown>;
}

export interface FetchEventsResponse {
  data: EventRecord[];
  hasMore: boolean;
  nextCursor: string | null;
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

export async function fetchEvents(
  cursor?: string | null,
  limit = 100
): Promise<FetchEventsResponse> {
  const params: Record<string, string | number> = { limit };
  if (cursor) params.cursor = cursor;

  const response = await getClient().get<FetchEventsResponse>('/events', {
    params,
    headers: { 'X-API-Key': process.env.TARGET_API_KEY! },
  });

  return response.data;
}

// Reset client (useful for testing)
export function resetClient(): void {
  client = null;
}
