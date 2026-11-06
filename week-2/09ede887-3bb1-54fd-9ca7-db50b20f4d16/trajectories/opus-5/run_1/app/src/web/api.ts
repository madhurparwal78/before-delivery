export interface SpeakerRef {
  readonly name: string;
  readonly company: string;
}

export interface Seats {
  readonly capacity: number;
  readonly reserved: number;
  readonly held: number;
  readonly left: number;
}

export interface Hold {
  readonly session_id: string;
  readonly held_until: string;
  readonly seconds_remaining: number;
}

export interface SessionView {
  readonly id: string;
  readonly day: number;
  readonly date: string;
  readonly start_local: string;
  readonly end_local: string;
  readonly start_instant: string;
  readonly end_instant: string;
  readonly title: string;
  readonly speakers: readonly SpeakerRef[];
  readonly stage: string | null;
  readonly stage_name: string | null;
  readonly location: string | null;
  readonly format: string | null;
  readonly format_label: string | null;
  readonly description: string;
  readonly seats: Seats | null;
  readonly waitlist_count: number | null;
  readonly reserved_by_me: boolean;
  readonly saved_by_me: boolean;
  readonly waitlist_position: number | null;
  readonly my_hold: Hold | null;
}

export interface Stage {
  readonly slug: string;
  readonly name: string;
  readonly description: string;
}

export interface AccountView {
  readonly id: number;
  readonly name: string;
  readonly email: string;
  readonly role: 'attendee' | 'organiser';
}

export interface MyAgenda {
  readonly reserved: readonly SessionView[];
  readonly held: readonly SessionView[];
  readonly waitlisted: readonly SessionView[];
  readonly saved: readonly SessionView[];
}

export interface SpeakerView {
  readonly slug: string;
  readonly name: string;
  readonly company: string;
  readonly sessions: readonly string[];
  readonly bio: string;
  readonly bio_html: string;
}

export interface OrganiserRow {
  readonly id: string;
  readonly title: string;
  readonly day: number;
  readonly start_local: string;
  readonly end_local: string;
  readonly seats: Seats;
  readonly waitlisted: number;
}

export interface RosterRow {
  readonly name: string;
  readonly email: string;
  readonly reserved_at: string;
}

export interface Leader {
  readonly rank: number;
  readonly display_name: string;
  readonly value: number;
  readonly distance: number;
}

export interface RecordView {
  readonly status: 'open' | 'closed' | 'revealed';
  readonly closes_at: string;
  readonly guess_count: number;
  readonly my_guess: { readonly value: number; readonly created_at: string } | null;
  readonly final_figure: number | null;
  readonly revealed_at: string | null;
  readonly leaderboard: readonly Leader[];
}

export interface WaitlistJoined {
  readonly waitlist: { readonly session_id: string; readonly position: number; readonly created_at: string };
}

export type ErrorCode =
  | 'invalid'
  | 'invalid_filter'
  | 'unauthenticated'
  | 'invalid_credentials'
  | 'forbidden'
  | 'not_found'
  | 'no_sessions'
  | 'method_not_allowed'
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'idempotency_key_reused'
  | 'email_taken'
  | 'not_reservable'
  | 'already_reserved'
  | 'time_conflict'
  | 'session_full'
  | 'already_waitlisted'
  | 'seats_available'
  | 'not_waitlisted'
  | 'no_reservation'
  | 'no_hold'
  | 'hold_expired'
  | 'below_reserved'
  | 'already_guessed'
  | 'contest_closed'
  | 'already_revealed'
  | 'request_in_progress'
  | 'rate_limited'
  | 'unavailable'
  | 'outage';

export class ApiFailure extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    readonly fields: Readonly<Record<string, string>> = {},
    readonly conflictsWith: string | null = null,
    readonly reserved: number | null = null,
  ) {
    super(code);
    this.name = 'ApiFailure';
  }
}

export interface Answer<T> {
  readonly value: T;
  readonly headers: Headers;
}

const ROOT = '/api/v2';

let bearer: string | null = null;

export function setBearer(token: string | null): void {
  bearer = token;
}

interface CallOptions {
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
  /** Retried once when the request gets no answer at all. */
  readonly retryOnce?: boolean;
}

async function send(method: string, path: string, options: CallOptions): Promise<Response> {
  const headers: Record<string, string> = { ...options.headers };
  if (bearer !== null) headers['Authorization'] = `Bearer ${bearer}`;
  let body: string | undefined;
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = body;
  try {
    return await fetch(path, init);
  } catch (error) {
    if (options.retryOnce !== true) throw error;
    return fetch(path, init);
  }
}

async function call<T>(method: string, path: string, options: CallOptions = {}): Promise<Answer<T>> {
  let response: Response;
  try {
    response = await send(method, path, options);
  } catch {
    throw new ApiFailure('outage', 0);
  }
  const text = await response.text();
  if (!response.ok) {
    let code: ErrorCode = 'outage';
    let fields: Record<string, string> = {};
    let conflictsWith: string | null = null;
    let reserved: number | null = null;
    try {
      const parsed = JSON.parse(text) as {
        error?: { code?: ErrorCode; fields?: Record<string, string>; conflicts_with?: string; reserved?: number };
      };
      if (parsed.error !== undefined && parsed.error.code !== undefined) {
        code = parsed.error.code;
        fields = parsed.error.fields ?? {};
        conflictsWith = parsed.error.conflicts_with ?? null;
        reserved = parsed.error.reserved ?? null;
      }
    } catch {
      code = 'outage';
    }
    throw new ApiFailure(code, response.status, fields, conflictsWith, reserved);
  }
  return { value: (text === '' ? null : JSON.parse(text)) as T, headers: response.headers };
}

export const api = {
  async health(): Promise<boolean> {
    try {
      return (await fetch('/api/health')).status === 200;
    } catch {
      return false;
    }
  },
  stages: () => call<Stage[]>('GET', `${ROOT}/stages`).then((answer) => answer.value),
  sessions: (query: string) =>
    call<SessionView[]>('GET', `${ROOT}/sessions${query}`).then((answer) => answer.value),
  session: (id: string) => call<SessionView>('GET', `${ROOT}/sessions/${encodeURIComponent(id)}`).then((a) => a.value),
  speakers: () => call<SpeakerView[]>('GET', `${ROOT}/speakers`).then((answer) => answer.value),
  me: () => call<AccountView>('GET', `${ROOT}/me`).then((answer) => answer.value),
  myAgenda: () => call<MyAgenda>('GET', `${ROOT}/me/agenda`).then((answer) => answer.value),
  record: () => call<RecordView>('GET', `${ROOT}/record`).then((answer) => answer.value),
  organiserSessions: () =>
    call<OrganiserRow[]>('GET', `${ROOT}/organiser/sessions`).then((answer) => answer.value),
  roster: (path: string) => call<RosterRow[]>('GET', path),
  login: (email: string, password: string) =>
    call<{ token: string; account: AccountView }>('POST', `${ROOT}/auth/login`, {
      body: { email, password },
    }).then((answer) => answer.value),
  signup: (name: string, email: string, password: string) =>
    call<{ token: string; account: AccountView }>('POST', `${ROOT}/auth/signup`, {
      body: { name, email, password },
    }).then((answer) => answer.value),
  logout: () => call<{ signed_out: boolean }>('POST', `${ROOT}/auth/logout`).then((answer) => answer.value),
  reserve: (id: string, idempotencyKey: string) =>
    call<{ reservation: { id: number }; seats: Seats }>(
      'POST',
      `${ROOT}/sessions/${encodeURIComponent(id)}/reservation`,
      { headers: { 'Idempotency-Key': idempotencyKey }, retryOnce: true },
    ).then((answer) => answer.value),
  cancel: (id: string) =>
    call<{ seats: Seats }>('DELETE', `${ROOT}/sessions/${encodeURIComponent(id)}/reservation`).then((a) => a.value),
  joinWaitlist: (id: string) =>
    call<WaitlistJoined>('POST', `${ROOT}/sessions/${encodeURIComponent(id)}/waitlist`).then((a) => a.value),
  leaveWaitlist: (id: string) =>
    call<{ waitlisted: boolean }>('DELETE', `${ROOT}/sessions/${encodeURIComponent(id)}/waitlist`).then((a) => a.value),
  claim: (id: string) =>
    call<{ reservation: { id: number }; seats: Seats }>('POST', `${ROOT}/sessions/${encodeURIComponent(id)}/claim`).then(
      (answer) => answer.value,
    ),
  release: (id: string) =>
    call<{ held: boolean }>('DELETE', `${ROOT}/sessions/${encodeURIComponent(id)}/hold`).then((a) => a.value),
  save: (id: string) =>
    call<{ saved: boolean }>('PUT', `${ROOT}/sessions/${encodeURIComponent(id)}/save`).then((a) => a.value),
  unsave: (id: string) =>
    call<{ saved: boolean }>('DELETE', `${ROOT}/sessions/${encodeURIComponent(id)}/save`).then((a) => a.value),
  setCapacity: (id: string, capacity: number) =>
    call<OrganiserRow>('PATCH', `${ROOT}/organiser/sessions/${encodeURIComponent(id)}`, { body: { capacity } }).then(
      (answer) => answer.value,
    ),
  saveBio: (slug: string, bio: string) =>
    call<SpeakerView>('PUT', `${ROOT}/organiser/speakers/${encodeURIComponent(slug)}/bio`, { body: { bio } }).then(
      (answer) => answer.value,
    ),
  guess: (value: number) =>
    call<{ guess: { value: number } }>('POST', `${ROOT}/record/guesses`, { body: { value } }).then((a) => a.value),
  reveal: (finalFigure: number) =>
    call<RecordView>('POST', `${ROOT}/organiser/record/reveal`, { body: { final_figure: finalFigure } }).then(
      (answer) => answer.value,
    ),
  async rosterCsv(id: string): Promise<{ blob: Blob; filename: string }> {
    const path = `${ROOT}/organiser/sessions/${encodeURIComponent(id)}/roster.csv`;
    const headers: Record<string, string> = {};
    if (bearer !== null) headers['Authorization'] = `Bearer ${bearer}`;
    let response: Response;
    try {
      response = await fetch(path, { headers });
    } catch {
      throw new ApiFailure('outage', 0);
    }
    if (!response.ok) throw new ApiFailure('outage', response.status);
    const disposition = response.headers.get('content-disposition') ?? '';
    const match = /filename="([^"]+)"/.exec(disposition);
    return { blob: await response.blob(), filename: match?.[1] ?? `roster-${id}.csv` };
  },
};

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
