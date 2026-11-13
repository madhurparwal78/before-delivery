import type {
  AthleteDetail,
  AthleteSummary,
  CoachLink,
  Comment,
  Item,
  LibraryItem,
  Me,
  PlanTemplate,
  SeriesDay,
  Threshold,
  WeekView,
  Workout,
} from '../domain/types.js';

export interface ApiFailure {
  status: number;
  errors?: Record<string, string>;
  error?: string;
  message?: string;
}

export class ApiCallError extends Error {
  constructor(readonly failure: ApiFailure) {
    super(failure.message ?? 'Request failed');
    this.name = 'ApiCallError';
  }
}

async function request<Result>(
  method: string,
  path: string,
  body?: unknown,
): Promise<Result> {
  const init: RequestInit = { method, headers: {} };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const response = await fetch(path, init);
  if (response.status === 204) return undefined as Result;
  const text = await response.text();
  const parsed: unknown = text === '' ? {} : JSON.parse(text);
  if (!response.ok) {
    const failure = parsed as ApiFailure;
    throw new ApiCallError({ ...failure, status: response.status });
  }
  return parsed as Result;
}

export const api = {
  me: () => request<Me>('GET', '/api/me'),
  signIn: (email: string, password: string) =>
    request<{ user: Me }>('POST', '/api/auth/sign-in', { email, password }),
  signOut: () => request<void>('POST', '/api/auth/sign-out'),
  athletes: () => request<{ athletes: AthleteSummary[] }>('GET', '/api/athletes'),
  athlete: (id: string) => request<AthleteDetail>('GET', `/api/athletes/${id}`),
  weeks: (id: string, week: string, before: number, after: number) =>
    request<{ today: string; weeks: WeekView[] }>(
      'GET',
      `/api/athletes/${id}/weeks?week=${week}&before=${before}&after=${after}`,
    ),
  series: (id: string) => request<{ days: SeriesDay[] }>('GET', `/api/athletes/${id}/series`),
  saveThreshold: (
    id: string,
    payload: { kind: 'ftp' | 'pace'; value: number; effective_from: string },
  ) =>
    request<{ threshold: Threshold; rescored: number; series_from: string }>(
      'POST',
      `/api/athletes/${id}/thresholds`,
      payload,
    ),
  createWorkout: (
    id: string,
    payload: {
      date: string;
      start_local?: string;
      sport: string;
      title: string;
      steps?: unknown;
      duration_s?: number;
      library_id?: string;
    },
  ) => request<{ workout: Workout }>('POST', `/api/athletes/${id}/workouts`, payload),
  manual: (
    id: string,
    payload: {
      date: string;
      sport: string;
      title: string;
      duration_s: number;
      avg_power_w?: number;
      avg_pace_s_per_km?: number;
    },
  ) => request<{ workout: Workout }>('POST', `/api/athletes/${id}/manual`, payload),
  upload: (id: string, form: FormData) =>
    request<{ workout: Workout }>('POST', `/api/athletes/${id}/uploads`, form),
  workout: (id: string) =>
    request<{ workout: Workout; item: Item; comments: Comment[] }>('GET', `/api/workouts/${id}`),
  patchWorkout: (
    id: string,
    payload: { version: number; date?: string; start_local?: string | null; title?: string; steps?: unknown },
  ) => request<{ workout: Workout }>('PATCH', `/api/workouts/${id}`, payload),
  deleteWorkout: (id: string) => request<void>('DELETE', `/api/workouts/${id}`),
  comments: (id: string) => request<{ comments: Comment[] }>('GET', `/api/workouts/${id}/comments`),
  postComment: (id: string, body: string) =>
    request<{ comment: Comment }>('POST', `/api/workouts/${id}/comments`, { body }),
  library: () => request<{ library: LibraryItem[] }>('GET', '/api/library'),
  createLibraryItem: (payload: { name: string; sport: string; steps: unknown }) =>
    request<{ item: LibraryItem }>('POST', '/api/library', payload),
  plans: () => request<{ plans: PlanTemplate[] }>('GET', '/api/plans'),
  applyPlan: (
    id: string,
    payload: { athlete_id: string; mode: 'start' | 'event'; date: string; event_name?: string },
  ) =>
    request<{
      created: number;
      skipped: number;
      kept: number;
      first_day: string;
      last_day: string;
    }>('POST', `/api/plans/${id}/apply`, payload),
  copyWeek: (
    id: string,
    payload: { week: string; workout_ids: string[]; to_athlete_id: string; to_week: string },
  ) => request<{ created: number; skipped: number }>('POST', `/api/athletes/${id}/copy-week`, payload),
  links: () => request<{ links: CoachLink[] }>('GET', '/api/links'),
  requestLink: (coachCode: string) =>
    request<{ link: { id: string; coach_id: string; coach_name: string } }>('POST', '/api/links', {
      coach_code: coachCode,
    }),
  acceptLink: (id: string) => request<{ link: CoachLink }>('POST', `/api/links/${id}/accept`),
  declineLink: (id: string) => request<{ link: CoachLink }>('POST', `/api/links/${id}/decline`),
  removeLink: (id: string) => request<void>('DELETE', `/api/links/${id}`),
};
