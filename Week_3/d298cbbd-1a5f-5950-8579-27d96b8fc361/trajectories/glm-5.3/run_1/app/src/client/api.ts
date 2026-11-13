// The browser's view of the published API and types.

export type Mode = 'time' | 'words' | 'quote' | 'custom';
export type Theme = 'sand' | 'cobalt' | 'carbon' | 'ledger';
export type CaretStyle = 'line' | 'block' | 'underline' | 'off';
export type QuickRestart = 'tab' | 'enter';

export interface SessionInfo { id: string; name: string; verified: boolean }

export interface TypistSettings {
  theme: Theme;
  caret: CaretStyle;
  smoothCaret: boolean;
  fontSize: number;
  blindMode: boolean;
  quickRestart: QuickRestart;
}

export interface TicketResponse {
  ticketId: string;
  seed: number | null;
  words: string[];
  quoteId: string | null;
  expiresAt: string;
}

export interface RunSubmission {
  ticketId: string;
  text: string[];
  log: { k: string; t: number }[];
  duration: number;
  speed: number;
  raw: number;
  accuracy: number;
  consistency: number;
  characters: { correct: number; incorrect: number; extra: number; missed: number };
}

export interface RunResponse {
  runId?: string;
  verdict?: 'counted' | 'not_counted';
  personalBest?: boolean;
  speed?: number | null;
  raw?: number | null;
  accuracy?: number | null;
  consistency?: number | null;
  proofKey?: string | null;
  error?: string;
  reason?: string | null;
}

export interface StoredRun {
  runId: string;
  mode: Mode;
  length: number | null;
  punctuation: boolean;
  numbers: boolean;
  quoteId: string | null;
  words: string[];
  log: unknown;
  duration: number | null;
  speed: number | null;
  raw: number | null;
  accuracy: number | null;
  consistency: number | null;
  characters: { correct: number; incorrect: number; extra: number; missed: number } | null;
  errorsByKey: Record<string, number> | null;
  perSecond: { second: number; speed: number; raw: number; errors: number }[] | null;
  verdict: 'counted' | 'not_counted';
  reason: string | null;
  finishedAt: string;
  proofKey: string | null;
}

export interface HistoryRow {
  runId: string;
  finishedAt: string;
  mode: Mode;
  length: number | null;
  speed: number | null;
  raw: number | null;
  accuracy: number | null;
  consistency: number | null;
  verdict: 'counted' | 'not_counted';
}

export interface BoardRowData { rank: number; name: string; speed: number; accuracy: number; finishedAt: string }

export interface ApiFailure {
  status: number;
  code: string;
  retryAfter?: number;
  errors?: Record<string, string>;
}

export class ApiRequestError extends Error {
  status: number;
  code: string;
  retryAfter?: number;
  errors?: Record<string, string>;

  constructor(failure: ApiFailure) {
    super(failure.code);
    this.status = failure.status;
    this.code = failure.code;
    this.retryAfter = failure.retryAfter;
    this.errors = failure.errors;
  }
}

export async function api<T>(path: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiRequestError({ status: 0, code: 'network' });
  }
  const text = await res.text();
  let json: unknown = null;
  if (text !== '') {
    try { json = JSON.parse(text); } catch { json = null; }
  }
  if (!res.ok) {
    const obj = (json ?? {}) as Record<string, unknown>;
    throw new ApiRequestError({
      status: res.status,
      code: typeof obj.error === 'string' ? obj.error : 'unknown',
      retryAfter: typeof obj.retryAfter === 'number' ? obj.retryAfter : undefined,
      errors: (obj.errors ?? undefined) as Record<string, string> | undefined,
    });
  }
  return json as T;
}

export interface PublicConfig {
  focusWarningMs: number;
  maxExtraLetters: number;
  raceCountdownSeconds: number;
  raceRejoinSeconds: number;
}
