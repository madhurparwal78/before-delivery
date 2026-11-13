export interface ApiResponse<T> {
  readonly status: number;
  readonly body: T;
  readonly networkError: boolean;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<ApiResponse<T>> {
  try {
    const response = await fetch(path, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      credentials: 'same-origin',
    });
    const text = await response.text();
    const parsed = text === '' ? null : (JSON.parse(text) as T);
    if (response.status === 401) {
      window.dispatchEvent(new CustomEvent('strikeproof:unauthenticated'));
    }
    return { status: response.status, body: parsed as T, networkError: false };
  } catch {
    return { status: 0, body: null as T, networkError: true };
  }
}

export const api = {
  get: <T>(path: string): Promise<ApiResponse<T>> => request<T>('GET', path),
  post: <T>(path: string, body: unknown = {}): Promise<ApiResponse<T>> =>
    request<T>('POST', path, body),
  put: <T>(path: string, body: unknown): Promise<ApiResponse<T>> => request<T>('PUT', path, body),
  del: <T>(path: string): Promise<ApiResponse<T>> => request<T>('DELETE', path),
};

export interface TicketResponse {
  readonly ticketId: string;
  readonly seed: number | null;
  readonly words: string[];
  readonly quoteId: string | null;
  readonly expiresAt: string;
}

export interface RunVerdict {
  readonly runId: string;
  readonly verdict: 'counted' | 'not_counted';
  readonly personalBest?: boolean;
  readonly speed?: number;
  readonly raw?: number;
  readonly accuracy?: number;
  readonly consistency?: number;
  readonly proofKey?: string;
  readonly error?: string;
}

export interface StoredRun {
  readonly runId: string;
  readonly mode: 'time' | 'words' | 'quote' | 'custom';
  readonly length: number | string | null;
  readonly punctuation: boolean;
  readonly numbers: boolean;
  readonly quoteId: string | null;
  readonly words: string[];
  readonly log: unknown;
  readonly duration: number | null;
  readonly speed: number | null;
  readonly raw: number | null;
  readonly accuracy: number | null;
  readonly consistency: number | null;
  readonly characters: {
    correct: number | null;
    incorrect: number | null;
    extra: number | null;
    missed: number | null;
  } | null;
  readonly errorsByKey: Record<string, number> | null;
  readonly perSecond: { second: number; speed: number; raw: number; errors: number }[] | null;
  readonly verdict: 'counted' | 'not_counted';
  readonly reason: string | null;
  readonly finishedAt: string;
  readonly proofKey: string | null;
}

export interface HistoryRun {
  readonly runId: string;
  readonly finishedAt: string;
  readonly mode: string;
  readonly length: number | string | null;
  readonly speed: number | null;
  readonly raw: number | null;
  readonly accuracy: number | null;
  readonly consistency: number | null;
  readonly verdict: string;
}

export interface HistoryResponse {
  readonly runs: HistoryRun[];
  readonly more: boolean;
  readonly customLengths: number[];
}

export interface BoardRow {
  readonly rank: number;
  readonly name: string;
  readonly speed: number;
  readonly accuracy: number;
  readonly finishedAt: string;
}

export interface AccountResponse {
  readonly name: string;
  readonly email: string;
  readonly verified: boolean;
  readonly testsCounted: number;
  readonly personalBests: {
    mode: string;
    length: number | string | null;
    punctuation: boolean;
    numbers: boolean;
    speed: number;
    accuracy: number;
    finishedAt: string;
    runId: string;
  }[];
}

export interface RoomSnapshot {
  readonly code: string;
  readonly state: 'open' | 'countdown' | 'racing' | 'finished';
  readonly racers: {
    name: string;
    host: boolean;
    left: boolean;
    progress: number;
    place: number | 'DNF' | 'Left' | null;
    speed: number | null;
    accuracy: number | null;
  }[];
  readonly words: string[] | null;
  readonly elapsedMs: number | null;
  readonly seq?: number;
  readonly ownEntries?: { k: string; t: number }[];
}
