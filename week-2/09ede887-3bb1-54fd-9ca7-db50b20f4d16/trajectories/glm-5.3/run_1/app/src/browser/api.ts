/**
 * The browser API client. It calls only /api/v2 routes and /api/health, sends
 * no secret but the caller's own token, and retries a dropped reservation once
 * with the same Idempotency-Key.
 */

export interface Seats {
  capacity: number;
  reserved: number;
  held: number;
  left: number;
}

export interface Session {
  id: string;
  day: number;
  date: string;
  start_local: string;
  end_local: string;
  start_instant: string;
  end_instant: string;
  title: string;
  speakers: Array<{ name: string; company: string }>;
  stage: string | null;
  stage_name: string | null;
  location: string | null;
  format: string | null;
  format_label: string | null;
  description: string;
  seats: Seats | null;
  waitlist_count: number;
  reserved_by_me: boolean;
  saved_by_me: boolean;
  waitlist_position: number | null;
  my_hold: { session_id: string; held_until: string; seconds_remaining: number } | null;
}

export interface Speaker {
  slug: string;
  name: string;
  company: string;
  sessions: string[];
  bio: string;
  bio_html: string;
}

export interface Stage {
  slug: string;
  name: string;
  description: string;
}

export interface Account {
  id: number;
  name: string;
  email: string;
  role: 'attendee' | 'organiser';
}

export interface ContestState {
  status: 'open' | 'closed' | 'revealed';
  closes_at: string;
  guess_count: number;
  my_guess: { value: number; created_at: string } | null;
  final_figure: number | null;
  revealed_at: string | null;
  leaderboard: Array<{ rank: number; display_name: string; value: number; distance: number }>;
}

export interface OrganiserRow {
  id: string;
  title: string;
  day: number;
  start_local: string;
  end_local: string;
  seats: Seats | null;
  waitlisted: number;
}

export interface RosterRow {
  name: string;
  email: string;
  reserved_at: string;
}

export interface MyAgenda {
  reserved: Session[];
  held: Session[];
  waitlisted: Session[];
  saved: Session[];
}

export interface ApiFailure {
  code: string;
  message: string;
  fields?: Record<string, string>;
  conflicts_with?: string;
  reserved?: number;
}

export class ApiError extends Error {
  constructor(public failure: ApiFailure, public status: number) {
    super(failure.code);
  }
}

const TOKEN_KEY = 'keel-outpost-token';

export function storedToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function storeToken(token: string | null): void {
  try {
    if (token === null) localStorage.removeItem(TOKEN_KEY);
    else localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* private mode: the token lives for this page only */
  }
}

interface CallOptions {
  method?: string;
  body?: unknown;
  key?: string;
  retryOnce?: boolean;
}

export async function api<T>(path: string, options: CallOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const token = storedToken();
  if (token !== null) headers['Authorization'] = `Bearer ${token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.key !== undefined) headers['Idempotency-Key'] = options.key;
  const attempt = async (): Promise<Response> =>
    fetch(`/api/v2${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  let res: Response;
  try {
    res = await attempt();
  } catch {
    // A dropped connection is retried once with the same key.
    if (options.retryOnce) {
      try {
        res = await attempt();
      } catch {
        throw new ApiError(
          { code: 'unavailable', message: 'Keel Outpost is not reachable right now. Try again in a moment.' },
          0,
        );
      }
    } else {
      throw new ApiError(
        { code: 'unavailable', message: 'Keel Outpost is not reachable right now. Try again in a moment.' },
        0,
      );
    }
  }
  const text = await res.text();
  if (!res.ok) {
    let failure: ApiFailure = { code: 'unavailable', message: 'Keel Outpost is not reachable right now. Try again in a moment.' };
    try {
      const parsed = JSON.parse(text) as { error: ApiFailure };
      failure = parsed.error;
    } catch {
      /* keep the outage copy */
    }
    if (res.status === 0) failure = { code: 'unavailable', message: 'Keel Outpost is not reachable right now. Try again in a moment.' };
    throw new ApiError(failure, res.status);
  }
  if (text === '') return null as T;
  return JSON.parse(text) as T;
}

/* ------------------------------------------------------------------ *
 * Endpoint helpers                                                    *
 * ------------------------------------------------------------------ */

export interface SessionFilters {
  day: '1' | '2' | 'all';
  stage: string;
  format: string;
  q: string;
}

export function sessionsQuery(filters: SessionFilters): string {
  const parts: string[] = [];
  if (filters.day !== 'all') parts.push(`day=${filters.day}`);
  if (filters.stage !== 'all') parts.push(`stage=${encodeURIComponent(filters.stage)}`);
  if (filters.format !== 'all') parts.push(`format=${encodeURIComponent(filters.format)}`);
  if (filters.q !== '') parts.push(`q=${encodeURIComponent(filters.q)}`);
  return parts.length === 0 ? '' : `?${parts.join('&')}`;
}

export const listSessions = (filters: SessionFilters): Promise<Session[]> =>
  api<Session[]>(`/sessions${sessionsQuery(filters)}`);

export const getSession = (id: string): Promise<Session> => api<Session>(`/sessions/${encodeURIComponent(id)}`);

export const listStages = (): Promise<Stage[]> => api<Stage[]>('/stages');

export const listSpeakers = (): Promise<Speaker[]> => api<Speaker[]>('/speakers');

export const getRecord = (): Promise<ContestState> => api<ContestState>('/record');

export const getMyAgenda = (): Promise<MyAgenda> => api<MyAgenda>('/me/agenda');

export const getMe = (): Promise<Account> => api<Account>('/me');

export const getOrganiserSessions = (): Promise<OrganiserRow[]> =>
  api<OrganiserRow[]>('/organiser/sessions');

/** Fetch a roster page, reading the Link header for the next page. */
export async function rosterPage(
  id: string,
  limit: number,
  cursor: string | null,
): Promise<{ rows: RosterRow[]; next: string | null }> {
  const headers: Record<string, string> = {};
  const token = storedToken();
  if (token !== null) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(
    `/api/v2/organiser/sessions/${encodeURIComponent(id)}/roster?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    { headers },
  );
  const text = await res.text();
  if (!res.ok) {
    let failure: ApiFailure = { code: 'unavailable', message: 'unavailable' };
    try {
      failure = (JSON.parse(text) as { error: ApiFailure }).error;
    } catch {
      /* keep the outage copy */
    }
    throw new ApiError(failure, res.status);
  }
  const link = res.headers.get('Link');
  const next = link === null ? null : (link.match(/<[^>]*[?&]cursor=([^&>]+)[^>]*>/)?.[1] ?? null);
  return { rows: JSON.parse(text) as RosterRow[], next };
}

/** Download a file with the organiser's token and save it under the given name. */
export async function downloadRoster(id: string): Promise<void> {
  const headers: Record<string, string> = {};
  const token = storedToken();
  if (token !== null) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`/api/v2/organiser/sessions/${encodeURIComponent(id)}/roster.csv`, { headers });
  if (!res.ok) {
    let failure: ApiFailure = { code: 'unavailable', message: 'unavailable' };
    try {
      failure = (JSON.parse(await res.text()) as { error: ApiFailure }).error;
    } catch {
      /* keep the outage copy */
    }
    throw new ApiError(failure, res.status);
  }
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const name = disposition.match(/filename="([^"]+)"/)?.[1] ?? `roster-${id}.csv`;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ------------------------------------------------------------------ *
 * Booking actions                                                     *
 * ------------------------------------------------------------------ */

function freshKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function reserve(sessionId: string): Promise<{ reservation: { id: number; session_id: string; created_at: string }; seats: Seats }> {
  return api(`/sessions/${encodeURIComponent(sessionId)}/reservation`, {
    method: 'POST',
    key: freshKey(),
    retryOnce: true,
  });
}

export const cancel = (sessionId: string): Promise<{ seats: Seats }> =>
  api(`/sessions/${encodeURIComponent(sessionId)}/reservation`, { method: 'DELETE' });

export const joinWaitlist = (sessionId: string): Promise<{ waitlist: { session_id: string; position: number; created_at: string } }> =>
  api(`/sessions/${encodeURIComponent(sessionId)}/waitlist`, { method: 'POST' });

export const leaveWaitlist = (sessionId: string): Promise<{ waitlisted: boolean }> =>
  api(`/sessions/${encodeURIComponent(sessionId)}/waitlist`, { method: 'DELETE' });

export const claim = (sessionId: string): Promise<{ reservation: unknown; seats: Seats }> =>
  api(`/sessions/${encodeURIComponent(sessionId)}/claim`, { method: 'POST' });

export const release = (sessionId: string): Promise<{ held: boolean }> =>
  api(`/sessions/${encodeURIComponent(sessionId)}/hold`, { method: 'DELETE' });

export const save = (sessionId: string): Promise<{ saved: boolean }> =>
  api(`/sessions/${encodeURIComponent(sessionId)}/save`, { method: 'PUT' });

export const unsave = (sessionId: string): Promise<{ saved: boolean }> =>
  api(`/sessions/${encodeURIComponent(sessionId)}/save`, { method: 'DELETE' });

/* ------------------------------------------------------------------ *
 * Accounts and the contest                                            *
 * ------------------------------------------------------------------ */

export const signup = (fields: { name: string; email: string; password: string }): Promise<{ token: string; account: Account }> =>
  api('/auth/signup', { method: 'POST', body: fields });

export const signin = (fields: { email: string; password: string }): Promise<{ token: string; account: Account }> =>
  api('/auth/login', { method: 'POST', body: fields });

export const signout = (): Promise<{ signed_out: boolean }> =>
  api('/auth/logout', { method: 'POST' });

export const submitGuess = (value: number): Promise<{ guess: { value: number; created_at: string } }> =>
  api('/record/guesses', { method: 'POST', body: { value } });

export const saveBio = (slug: string, bio: string): Promise<Speaker> =>
  api(`/organiser/speakers/${encodeURIComponent(slug)}/bio`, { method: 'PUT', body: { bio } });

export const setCapacity = (id: string, capacity: number): Promise<OrganiserRow> =>
  api(`/organiser/sessions/${encodeURIComponent(id)}`, { method: 'PATCH', body: { capacity } });

export const reveal = (finalFigure: number): Promise<ContestState> =>
  api('/organiser/record/reveal', { method: 'POST', body: { final_figure: finalFigure } });
