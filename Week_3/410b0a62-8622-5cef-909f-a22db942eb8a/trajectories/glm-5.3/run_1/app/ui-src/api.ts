export interface ApiErrorShape {
  status: number;
  code: string;
  message: string;
  errors: Record<string, string>;
}

export class ApiCallError extends Error {
  status: number;
  code: string;
  errors: Record<string, string>;

  constructor(status: number, code: string, message: string, errors: Record<string, string>) {
    super(message);
    this.status = status;
    this.code = code;
    this.errors = errors;
  }
}

async function request<T>(method: string, path: string, body?: unknown, isForm = false): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin' };
  if (body !== undefined) {
    if (isForm) {
      init.body = body as FormData;
    } else {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(body);
    }
  }
  const res = await fetch(`/api${path}`, init);
  if (res.status === 204) return undefined as T;
  const contentType = res.headers.get('Content-Type') ?? '';
  if (!contentType.includes('application/json')) {
    if (!res.ok) throw new ApiCallError(res.status, 'http_error', 'Something went wrong.', {});
    return undefined as T;
  }
  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    if (data.errors && typeof data.errors === 'object') {
      const first = Object.values(data.errors as Record<string, string>)[0] ?? 'Something went wrong.';
      throw new ApiCallError(res.status, (data.error as string) ?? 'validation_error', first, data.errors as Record<string, string>);
    }
    throw new ApiCallError(res.status, (data.error as string) ?? 'error', (data.message as string) ?? 'Something went wrong.', {});
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
  upload: <T>(path: string, form: FormData) => request<T>('POST', path, form, true),
};

export interface Me {
  id: string;
  role: 'athlete' | 'coach';
  name: string;
  email: string;
  tz: string;
  coach_code: string | null;
  today: string;
}

export interface WorkoutJson {
  id: string;
  athlete_id: string;
  kind: 'planned' | 'completed';
  sport: 'bike' | 'run';
  title: string;
  date: string;
  start_local: string | null;
  start_utc: string | null;
  duration_s: number;
  steps: unknown[] | null;
  planned_tss: number | null;
  planned_if: number | null;
  tss: number | null;
  if: number | null;
  np_w: number | null;
  ns_mps: number | null;
  source: string;
  version: number;
  file: { name: string; size: number; sha256: string; content_type: string } | null;
}

export interface ItemJson {
  planned: WorkoutJson | null;
  completed: WorkoutJson | null;
  compliance: 'on-target' | 'close' | 'off-target' | 'missed' | 'unplanned' | 'planned';
  ratio: number | null;
}

export interface DayJson {
  date: string;
  items: ItemJson[];
}

export interface WeekJson {
  week: string;
  monday: string;
  planned_tss: number;
  completed_tss: number;
  tsb: number | null;
  tally: Record<string, number>;
  sports: { bike_tss: number; run_tss: number; bike_s: number; run_s: number; sessions: number };
  days: DayJson[];
}

export interface SeriesDay {
  date: string;
  tss: number;
  ctl: number;
  atl: number;
  tsb: number;
}

export interface CommentJson {
  id: string;
  author_id: string;
  author_name: string;
  body: string;
  created_at: string;
}

export interface LinkJson {
  id: string;
  coach_id: string;
  coach_name: string;
  athlete_id: string;
  athlete_name: string;
  status: 'requested' | 'accepted' | 'declined' | 'removed' | 'expired';
  expires_at: string | null;
}

export interface LibraryItem {
  id: string;
  name: string;
  sport: 'bike' | 'run';
  duration_s: number;
  planned_tss: number;
  planned_if: number;
}

export interface AthleteJson {
  id: string;
  name: string;
  tz: string;
  week: { week: string; planned_tss: number; completed_tss: number };
  latest: ItemJson | null;
}

export interface HomePayload {
  today: string;
  weeks: WeekJson[];
  series: SeriesDay[];
  recent: { id: string; title: string; date: string; tss: number | null; sport: string }[];
  event: { name: string; date: string } | null;
  banner: { date: string; tss: number; ctl: number; atl: number; tsb: number } | null;
  rings: { span: number; percent: number | null }[];
  thresholds: { kind: string; value: number; effective_from: string }[];
}
