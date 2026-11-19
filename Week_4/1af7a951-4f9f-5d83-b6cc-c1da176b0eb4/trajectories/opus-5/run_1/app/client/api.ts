export type CohortPhase = 'draft' | 'enrolling' | 'baseline' | 'technique' | 'closed';
export type SignCategory = 'inner_awareness' | 'action' | 'form' | 'context';
export type Technique = 'none' | 'mild' | 'ssild';

export interface Cohort {
  id: string;
  name: string;
  coach_name: string;
  starts_on: string;
  phase: CohortPhase;
  week: number | null;
  price_cents: number;
  seats: number;
  seats_left: number;
}

export interface Enrollment {
  id: string;
  cohort_id: string;
  cohort_name: string;
  name: string;
  email: string;
  status: 'pending_payment' | 'active' | 'refunded';
  price_cents: number;
  home_tz: string;
  bedtime: string;
  wake_alarm: string;
  first_night: string | null;
  receipt_status: 'none' | 'pending' | 'sent';
}

export interface Sign {
  id: string;
  entry_id: string;
  start: number;
  end: number;
  phrase: string;
  category: SignCategory;
  night_key: string;
}

export interface Memo {
  content_type: string;
  size_bytes: number;
  duration_ms: number;
}

export interface Entry {
  id: string;
  night_key: string;
  night_number: number;
  title: string;
  text: string;
  dreams_recalled: number;
  lucid: boolean;
  wbtb: boolean;
  technique: Technique;
  technique_minutes: number;
  late_recall: boolean;
  shared: boolean;
  created_at: string;
  memo: Memo | null;
  signs: Sign[];
}

export interface NightStatus {
  night_key: string;
  night_number: number;
  first_night: string | null;
  capture_window: 'open' | 'closed';
  bedtime: string;
  wake_alarm: string;
  home_tz: string;
  technique_unlocked: boolean;
  cohort_phase: CohortPhase;
}

export interface Constellation {
  category: SignCategory;
  stars: number;
  tagged_nights: number;
  halo_px: number;
}

export interface Dreamscape {
  constellations: Constellation[];
  target_category: SignCategory | null;
}

export type Tallies = Record<SignCategory, number>;

export interface SharedEntry {
  entry_id: string;
  night_key: string;
  title: string;
  text: string;
  has_memo: boolean;
}

export interface RosterRow {
  enrollment_id: string;
  display_name: string;
  status: 'active' | 'refunded';
  night_number: number;
  nights_logged: number;
  recall_rate: number;
  technique_minutes: number;
  wbtb_nights: number;
  reality_checks: number;
  sign_tallies: Tallies;
  shared_entries: SharedEntry[];
}

export interface Session {
  role: 'dreamer' | 'coach';
  name: string;
  id: string;
}

export interface ApiResult<T> {
  status: number;
  ok: boolean;
  body: T | null;
  errorCode: string | null;
  fieldErrors: Record<string, string> | null;
  extra: Record<string, unknown> | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function request<T>(
  method: string,
  path: string,
  options: { json?: unknown; body?: BodyInit; headers?: Record<string, string> } = {},
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  let body: BodyInit | undefined = options.body;
  if (options.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.json);
  }
  let response: Response;
  try {
    response = await fetch(path, { method, headers, body, credentials: 'same-origin' });
  } catch {
    return {
      status: 0,
      ok: false,
      body: null,
      errorCode: null,
      fieldErrors: null,
      extra: null,
    };
  }
  let parsed: unknown = null;
  const text = await response.text().catch(() => '');
  if (text !== '') {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  const record = isRecord(parsed) ? parsed : null;
  const errors = record !== null && isRecord(record['errors']) ? record['errors'] : null;
  const fieldErrors: Record<string, string> | null =
    errors === null
      ? null
      : Object.fromEntries(
          Object.entries(errors).map(([key, value]) => [key, typeof value === 'string' ? value : '']),
        );
  const code = record !== null && typeof record['error'] === 'string' ? record['error'] : null;
  const typed = response.ok && parsed !== null ? (parsed as T) : null;
  return {
    status: response.status,
    ok: response.ok,
    body: typed,
    errorCode: code,
    fieldErrors,
    extra: record,
  };
}

export const api = {
  cohorts: () => request<{ cohorts: Cohort[] }>('GET', '/api/cohorts'),
  cohort: (id: string) => request<{ cohort: Cohort }>('GET', `/api/cohorts/${id}`),
  timeZones: () => request<{ zones: string[] }>('GET', '/api/time-zones'),
  createEnrollment: (json: unknown) =>
    request<{ enrollment: Enrollment; access_code: string }>('POST', '/api/enrollments', { json }),
  enrollment: (id: string) => request<{ enrollment: Enrollment }>('GET', `/api/enrollments/${id}`),
  pay: (id: string) => request<{ enrollment: Enrollment }>('POST', `/api/enrollments/${id}/pay`),
  signIn: (accessCode: string) =>
    request<Session>('POST', '/api/session', { json: { access_code: accessCode } }),
  session: () => request<Session>('GET', '/api/session'),
  signOut: () => request<null>('DELETE', '/api/session'),
  landing: (next: string | null) =>
    request<{ landing: string }>(
      'GET',
      next === null ? '/api/landing' : `/api/landing?next=${encodeURIComponent(next)}`,
    ),
  night: () => request<NightStatus>('GET', '/api/me/night'),
  settings: (json: unknown) =>
    request<{
      home_tz: string;
      bedtime: string;
      wake_alarm: string;
      night_key: string;
      night_number: number;
      night_held: boolean;
    }>('PATCH', '/api/me/settings', { json }),
  entries: () => request<{ entries: Entry[] }>('GET', '/api/me/entries'),
  saveEntry: (id: string, json: unknown) =>
    request<{ entry: Entry }>('PUT', `/api/me/entries/${id}`, { json }),
  share: (id: string, shared: boolean) =>
    request<{ entry: Entry }>('PUT', `/api/me/entries/${id}/share`, { json: { shared } }),
  uploadMemo: (id: string, blob: Blob, durationMs: number) =>
    request<{ memo: Memo }>('PUT', `/api/me/entries/${id}/memo`, {
      body: blob,
      headers: { 'Content-Type': blob.type, 'X-Memo-Duration-Ms': String(durationMs) },
    }),
  tagSign: (entryId: string, start: number, end: number, category: SignCategory) =>
    request<{ sign: Sign; tallies: Tallies }>('POST', `/api/me/entries/${entryId}/signs`, {
      json: { start, end, category },
    }),
  dreamscape: () => request<Dreamscape>('GET', '/api/me/dreamscape'),
  realityCheck: (id: string, category: SignCategory) =>
    request<{ reality_check: { id: string; category: SignCategory; night_key: string }; night_count: number }>(
      'POST',
      '/api/me/reality-checks',
      { json: { id, category } },
    ),
  coachCohorts: () => request<{ cohorts: Cohort[] }>('GET', '/api/coach/cohorts'),
  createCohort: (json: unknown) =>
    request<{ cohort: Cohort }>('POST', '/api/coach/cohorts', { json }),
  publishCohort: (id: string) =>
    request<{ cohort: Cohort }>('POST', `/api/coach/cohorts/${id}/publish`),
  closeCohort: (id: string) => request<{ cohort: Cohort }>('POST', `/api/coach/cohorts/${id}/close`),
  roster: (id: string) =>
    request<{ cohort: Cohort; dreamers: RosterRow[] }>('GET', `/api/coach/cohorts/${id}/roster`),
  digest: (id: string) =>
    request<{ digest: { week: number; to: string; dreamers: number; replayed: boolean } }>(
      'POST',
      `/api/coach/cohorts/${id}/digest`,
    ),
  refund: (id: string) =>
    request<{ dreamer: RosterRow }>('POST', `/api/coach/enrollments/${id}/refund`),
};
