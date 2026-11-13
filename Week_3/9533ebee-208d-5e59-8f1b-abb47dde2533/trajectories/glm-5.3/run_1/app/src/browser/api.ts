import type { Actor, PoolsResponse, Position, Posting, Settlement, WalletResponse, LedgerTotals } from './types.js';

const TOKEN_KEY = 'quillmoor-token';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly errors?: Record<string, string>;

  constructor(status: number, code: string, detail: string, errors?: Record<string, string>) {
    super(detail);
    this.status = status;
    this.code = code;
    this.errors = errors;
  }
}

export class NetworkError extends Error {
  constructor() {
    super('Couldn\u2019t reach Quillmoor. Press the same button again to retry safely.');
  }
}

export function getToken(): string | null {
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token === null) window.localStorage.removeItem(TOKEN_KEY);
  else window.localStorage.setItem(TOKEN_KEY, token);
}

async function request<T>(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<{ data: T; replayed: boolean }> {
  const token = getToken();
  const init: RequestInit = {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token !== null ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers ?? {}),
    },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new NetworkError();
  }
  const contentType = response.headers.get('Content-Type') ?? '';
  const replayed = response.headers.get('Idempotency-Replayed') === 'true';
  if (!contentType.includes('json')) {
    if (!response.ok) throw new ApiError(response.status, 'internal_error', 'Something went wrong on our side \u2013 nothing is confirmed.');
    throw new ApiError(500, 'internal_error', 'Something went wrong on our side \u2013 nothing is confirmed.');
  }
  const data = await response.json().catch((): unknown => null);
  if (!response.ok) {
    const problem = (data ?? {}) as { status?: number; code?: string; detail?: string; errors?: Record<string, string> };
    throw new ApiError(problem.status ?? response.status, problem.code ?? 'internal_error', problem.detail ?? '', problem.errors);
  }
  return { data: data as T, replayed };
}

export async function getActors(): Promise<Actor[]> {
  const { data } = await request<{ actors: Actor[] }>('GET', '/api/actors');
  return data.actors;
}

export async function createSession(actorId: string): Promise<{ token: string; actor: Actor }> {
  const { data } = await request<{ token: string; actor_id: string; role: string }>('POST', '/api/sessions', { actor_id: actorId });
  setToken(data.token);
  const me = await getMe();
  return { token: data.token, actor: me };
}

export async function getMe(): Promise<Actor> {
  const { data } = await request<Actor>('GET', '/api/me');
  return data;
}

export async function getPools(): Promise<PoolsResponse> {
  const { data } = await request<PoolsResponse>('GET', '/api/pools');
  return data;
}

export async function getWallet(): Promise<WalletResponse> {
  const { data } = await request<WalletResponse>('GET', '/api/wallet');
  return data;
}

export async function getPositions(query = ''): Promise<{ positions: Position[]; server_time: string }> {
  const { data } = await request<{ positions: Position[]; server_time: string }>('GET', `/api/positions${query}`);
  return data;
}

export async function getPosition(id: string): Promise<Position> {
  const { data } = await request<Position>('GET', `/api/positions/${encodeURIComponent(id)}`);
  return data;
}

export async function getQueue(): Promise<{ positions: Position[]; server_time: string }> {
  const { data } = await request<{ positions: Position[]; server_time: string }>('GET', '/api/liquidations/queue');
  return data;
}

export async function getSettlement(id: string): Promise<Settlement> {
  const { data } = await request<Settlement>('GET', `/api/settlements/${encodeURIComponent(id)}`);
  return data;
}

export async function getLedgerTotals(): Promise<LedgerTotals> {
  const { data } = await request<LedgerTotals>('GET', '/api/ledger/totals');
  return data;
}

export async function getPostings(query: string): Promise<{ postings: Posting[]; server_time: string }> {
  const { data } = await request<{ postings: Posting[]; server_time: string }>('GET', `/api/ledger/postings${query}`);
  return data;
}

export async function getRisk(asset: string): Promise<{ body: Record<string, number>; etag: string }> {
  const response = await fetch(`/api/assets/${asset}/risk`, {
    headers: { Authorization: `Bearer ${getToken() ?? ''}` },
  });
  const data = await response.json().catch((): Record<string, number> => ({}));
  if (!response.ok) {
    const problem = data as { status?: number; code?: string; detail?: string; errors?: Record<string, string> };
    throw new ApiError(problem.status ?? response.status, problem.code ?? 'internal_error', problem.detail ?? '', problem.errors);
  }
  return { body: data as Record<string, number>, etag: response.headers.get('ETag') ?? '' };
}

export { request };
