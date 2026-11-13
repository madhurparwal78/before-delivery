import { formatInstantDisplay } from '../../lib/format';

interface Problem {
  type: string;
  title: string;
  status: number;
  code: string;
  errors?: Record<string, string>;
  conflictingRequestId?: string;
  recordId?: string;
}

export class ApiFailure extends Error {
  constructor(
    readonly problem: Problem,
    readonly retryAfter: number | null,
  ) {
    super(problem.title);
  }

  get code(): string {
    return this.problem.code;
  }

  get status(): number {
    return this.problem.status;
  }

  field(name: string): string | undefined {
    return this.problem.errors ? this.problem.errors[name] : undefined;
  }

  get firstFieldError(): { field: string; message: string } | null {
    if (!this.problem.errors) return null;
    const [field, message] = Object.entries(this.problem.errors)[0] ?? [];
    return field && message ? { field, message } : null;
  }
}

interface ApiResult<T> {
  data: T;
  status: number;
  etag: string | null;
  replayed: boolean;
}

const TOKEN_KEY = 'twohouse.token';

export function token(): string | null {
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(value: string): void {
  window.localStorage.setItem(TOKEN_KEY, value);
}

export function clearToken(): void {
  window.localStorage.removeItem(TOKEN_KEY);
}

export interface Me {
  userId: string;
  name: string;
  role: 'planning' | 'other';
  household: {
    id: string;
    name: string;
    planningName: string;
    otherName: string;
    otherJoined: boolean;
    today: string;
    zone: string;
    currency: string;
    currencyExponent: number;
  };
}

let cachedMe: Me | null = null;

export function cachedIdentity(): Me | null {
  return cachedMe;
}

export function setIdentity(value: Me | null): void {
  cachedMe = value;
}

export function newIdempotencyKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

interface RequestOptions {
  json?: unknown;
  body?: BodyInit;
  contentType?: string;
  ifMatch?: string;
  ifNoneMatch?: string;
  idempotencyKey?: string;
  signal?: AbortSignal;
  raw?: boolean;
}

type UnauthorisedHandler = () => void;

let onUnauthorised: UnauthorisedHandler = () => undefined;

export function handleUnauthorised(handler: UnauthorisedHandler): void {
  onUnauthorised = handler;
}

export async function api<T>(method: string, path: string, options: RequestOptions = {}): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {};
  const bearer = token();
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  let body: BodyInit | undefined;
  if (options.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.json);
  } else if (options.body !== undefined) {
    body = options.body;
    if (options.contentType) headers['Content-Type'] = options.contentType;
  }
  if (options.ifMatch) headers['If-Match'] = options.ifMatch;
  if (options.ifNoneMatch) headers['If-None-Match'] = options.ifNoneMatch;
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
  const response = await fetch(path, { method, headers, body, signal: options.signal });
  const etag = response.headers.get('ETag');
  const replayed = response.headers.get('Idempotent-Replayed') === 'true';
  if (response.status === 401) {
    onUnauthorised();
  }
  if (response.status === 204 || response.status === 304) {
    return { data: undefined as T, status: response.status, etag, replayed };
  }
  if (!response.ok) {
    const problem = (await response.json()) as Problem;
    const retryAfter = response.headers.get('Retry-After');
    throw new ApiFailure(problem, retryAfter === null ? null : Number.parseInt(retryAfter, 10));
  }
  if (options.raw) {
    const buffer = await response.arrayBuffer();
    return { data: buffer as unknown as T, status: response.status, etag, replayed };
  }
  const data = (await response.json()) as T;
  return { data, status: response.status, etag, replayed };
}

export function householdPath(suffix: string): string {
  const me = cachedMe;
  if (!me) throw new Error('no identity loaded');
  return `/api/households/${me.household.id}${suffix}`;
}

/** The signed-in parent, or null when the token is missing or no longer live; any other failure is thrown. */
export async function loadIdentity(): Promise<Me | null> {
  if (!token()) return null;
  try {
    const result = await api<Me>('GET', '/api/me');
    cachedMe = result.data;
    return cachedMe;
  } catch (error) {
    if (error instanceof ApiFailure && error.status === 401) return null;
    throw error;
  }
}

export function lapsedCopy(answerBy: string | null, zone: string): string {
  return answerBy ? `This request lapsed at ${formatInstantDisplay(answerBy, zone)}.` : 'This request lapsed.';
}

export const STALE_COPY = 'This changed while you were looking. It now shows the latest version.';

export interface FailureContext {
  /** The request's answer-by instant and the zone it reads in, for the lapsed copy. */
  lapsed?: { answerBy: string | null; zone: string };
  /** What storage did not do, for the storage outage copy. */
  storageDid?: 'saved' | 'deleted';
}

/** The one sentence a parent reads when a request fails. */
export function faultCopy(error: unknown, context: FailureContext = {}): string {
  if (!(error instanceof ApiFailure)) return 'Something went wrong. Try again.';
  if (error.code === 'precondition_failed') return STALE_COPY;
  if (error.code === 'request_lapsed') {
    return context.lapsed ? lapsedCopy(context.lapsed.answerBy, context.lapsed.zone) : lapsedCopy(null, '');
  }
  if (error.code === 'storage_unavailable') return `Couldn't reach storage \u2013 nothing was ${context.storageDid ?? 'saved'}. Try again.`;
  return error.firstFieldError?.message ?? error.problem.title;
}
