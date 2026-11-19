export interface ApiMember {
  id: string;
  name: string;
  email: string;
  role: 'owner' | 'member' | 'operator';
  timeZone: string;
  thresholdMinutes: number;
}

export interface ApiWorkspace {
  id: string;
  name: string;
  state: 'trialing' | 'active' | 'past_due' | 'read_only' | 'cancelled';
  trialEndsAt: string;
  writable: boolean;
}

export interface ApiSession {
  id: string;
  taskId: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  start: string;
  end: string;
  version: number;
}

export interface ApiTask {
  id: string;
  title: string;
  estimateMinutes: number | null;
  dayDate: string | null;
  position: number;
  status: 'open' | 'done';
  source: string | null;
  externalId: string | null;
  dueDate: string | null;
  version: number;
  session: ApiSession | null;
}

export interface ApiDay {
  date: string;
  label: string;
  taskMinutes: number;
  meetingMinutes: number;
  routineMinutes: number;
  plannedMinutes: number;
  overByMinutes: number;
  tasks: ApiTask[];
}

export interface ApiRoutine {
  id: string;
  name: string;
  startTime: string;
  durationMinutes: number;
  repeats: 'daily' | 'weekdays';
}

export interface CalendarItem {
  kind: 'session' | 'routine' | 'meeting';
  id: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  start: string;
  end: string;
  version?: number;
}

export interface BoardResponse {
  today: string;
  timeZone: string;
  thresholdMinutes: number;
  days: ApiDay[];
  backlog: ApiTask[];
}

export interface ImportTaskSummary {
  batchId: string;
  created: number;
  updated: number;
  unchanged: number;
  merged: number;
  rejected: Array<{ line: number; reason: string }>;
  orphaned: Array<{ externalId: string; title: string }>;
}

export interface ImportCalendarSummary {
  batchId: string;
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
}

export interface ShutdownPreview {
  date: string;
  done: Array<{ id: string; title: string }>;
  carriedOver: Array<{ id: string; title: string }>;
  tomorrowFirst: { title: string; startTime: string } | null;
  digest?: 'sent' | 'queued' | 'already_sent';
}

export interface MemberRow {
  id: string;
  name: string;
  email: string;
  role: 'owner' | 'member' | 'operator';
  status: 'active' | 'invited' | 'pending_billing';
}

export interface SeatsInfo {
  active: number;
  billed: number | null;
}

export interface ReviewRow {
  memberId: string;
  name: string;
  plannedMinutes: number;
  doneMinutes: number;
}

export interface ReviewResponse {
  week: string;
  members: ReviewRow[];
  totals: { plannedMinutes: number; doneMinutes: number };
}

export interface OpsWorkspace {
  id: string;
  name: string;
  state: string;
  trialEndsAt: string;
  activeSeats: number;
  billedSeats: number | null;
  lastBillingEventAt: string | null;
  outbox: { pending: number; sent: number };
  imports: { batches: number; lastAt: string | null };
}

export interface ApiFailure {
  status: number;
  code: string;
  message: string;
  fields?: Record<string, string>;
  current?: unknown;
}

async function request<T>(method: string, path: string, body?: unknown, opts?: { raw?: boolean; contentType?: string; headers?: Record<string, string> }): Promise<T> {
  const headers: Record<string, string> = {};
  let payload: string | undefined;
  if (body !== undefined) {
    if (opts?.raw === true) {
      payload = body as string;
      headers['Content-Type'] = opts.contentType ?? 'text/plain';
    } else {
      payload = JSON.stringify(body);
      headers['Content-Type'] = 'application/json; charset=utf-8';
    }
  }
  for (const [k, v] of Object.entries(opts?.headers ?? {})) headers[k] = v;
  const res = await fetch(path, { method, headers, body: payload });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (!res.ok) {
    const err = parsed as { error?: string; message?: string; fields?: Record<string, string>; current?: unknown } | null;
    const failure: ApiFailure = {
      status: res.status,
      code: err?.error ?? 'bad_request',
      message: err?.message ?? 'Something went wrong on our side. Nothing was changed.',
      fields: err?.fields,
      current: err?.current,
    };
    throw failure;
  }
  return parsed as T;
}

export const api = {
  get: <T>(path: string): Promise<T> => request<T>('GET', path),
  post: <T>(path: string, body?: unknown): Promise<T> => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown): Promise<T> => request<T>('PATCH', path, body),
  delete: <T>(path: string): Promise<T> => request<T>('DELETE', path),
  postRaw: <T>(path: string, body: string, contentType: string, headers?: Record<string, string>): Promise<T> =>
    request<T>('POST', path, body, { raw: true, contentType, headers }),
};

export const isFailure = (e: unknown): e is ApiFailure =>
  typeof e === 'object' && e !== null && 'status' in e && 'code' in e;
