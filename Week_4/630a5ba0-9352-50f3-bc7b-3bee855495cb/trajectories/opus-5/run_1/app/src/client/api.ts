import type {
  ApiErrorBody,
  BoardDto,
  CalendarDto,
  CalendarImportResultDto,
  DayDto,
  MeDto,
  MemberDto,
  OpsWorkspaceDto,
  ReviewDto,
  RoutineDto,
  SeatsDto,
  SessionDto,
  ShutdownPreviewDto,
  ShutdownResultDto,
  TaskDto,
  TaskImportResultDto,
  WorkspaceDto,
  WorkspaceMemberDto,
} from '../shared/types.js';

export class RequestFailed extends Error {
  constructor(
    readonly status: number,
    readonly payload: ApiErrorBody,
  ) {
    super(payload.message);
  }

  get code(): string {
    return this.payload.error;
  }
}

const NO_RESPONSE: ApiErrorBody = {
  error: 'no_response',
  message: 'Something went wrong on our side. Nothing was changed.',
};

async function request<T>(
  method: string,
  path: string,
  options: { body?: unknown; raw?: string; contentType?: string; headers?: Record<string, string> } = {},
): Promise<T> {
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  let body: string | undefined;
  if (options.raw !== undefined) {
    body = options.raw;
    headers['Content-Type'] = options.contentType ?? 'text/plain';
  } else if (options.body !== undefined) {
    body = JSON.stringify(options.body);
    headers['Content-Type'] = 'application/json; charset=utf-8';
  }

  let response: globalThis.Response;
  try {
    response = await fetch(path, { method, headers, body, credentials: 'same-origin' });
  } catch {
    throw new RequestFailed(0, NO_RESPONSE);
  }

  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const parsed: unknown = text.length > 0 ? JSON.parse(text) : null;
  if (!response.ok) {
    const payload =
      parsed && typeof parsed === 'object' && 'error' in parsed ? (parsed as ApiErrorBody) : NO_RESPONSE;
    throw new RequestFailed(response.status, payload);
  }
  return parsed as T;
}

export interface TaskChangeResult {
  task: TaskDto;
  days: DayDto[];
}

export interface SessionChangeResult {
  session: SessionDto;
  task: TaskDto;
  days: DayDto[];
}

export const api = {
  me: () => request<MeDto>('GET', '/api/me'),
  signIn: (email: string, password: string) =>
    request<{ member: MemberDto; workspace: WorkspaceDto | null }>('POST', '/api/auth/sign-in', {
      body: { email, password },
    }),
  signOut: () => request<void>('POST', '/api/auth/sign-out'),
  startTrial: (body: {
    workspaceName: string;
    ownerName: string;
    email: string;
    password: string;
    timeZone: string;
  }) =>
    request<{ workspace: WorkspaceDto; member: MemberDto; billing: 'registered' | 'queued' }>(
      'POST',
      '/api/workspaces',
      { body },
    ),
  invitation: (token: string) =>
    request<{ workspaceName: string; email: string }>('GET', `/api/invitations/${token}`),
  acceptInvitation: (token: string, body: { name: string; password: string; timeZone: string }) =>
    request<{ member: MemberDto; workspace: WorkspaceDto }>('POST', `/api/invitations/${token}/accept`, {
      body,
    }),
  updateMe: (body: { timeZone?: string; thresholdMinutes?: number }) =>
    request<{ member: MemberDto; today: string }>('PATCH', '/api/me', { body }),

  board: (start?: string) =>
    request<BoardDto>('GET', start ? `/api/board?start=${start}` : '/api/board'),
  calendar: (from: string, to: string) =>
    request<CalendarDto>('GET', `/api/calendar?from=${from}&to=${to}`),
  createTask: (body: { title: string; estimateMinutes?: number | null; dayDate?: string | null }) =>
    request<TaskChangeResult>('POST', '/api/tasks', { body }),
  patchTask: (id: string, body: Record<string, unknown>) =>
    request<TaskChangeResult>('PATCH', `/api/tasks/${id}`, { body }),
  suggest: (query: string) =>
    request<{ suggestions: { id: string; title: string; estimateMinutes: number | null }[] }>(
      'GET',
      `/api/tasks/suggest?q=${encodeURIComponent(query)}`,
    ),

  createSession: (body: { taskId: string; date: string; startTime: string }, key: string) =>
    request<SessionChangeResult>('POST', '/api/sessions', { body, headers: { 'Idempotency-Key': key } }),
  patchSession: (id: string, body: { version: number; date: string; startTime: string }) =>
    request<SessionChangeResult>('PATCH', `/api/sessions/${id}`, { body }),
  deleteSession: (id: string, version: number) =>
    request<void>('DELETE', `/api/sessions/${id}?version=${version}`),

  importTasks: (csv: string) =>
    request<TaskImportResultDto>('POST', '/api/imports/tasks', { raw: csv, contentType: 'text/csv' }),
  importCalendar: (ics: string) =>
    request<CalendarImportResultDto>('POST', '/api/imports/calendar', {
      raw: ics,
      contentType: 'text/calendar',
    }),

  routines: () => request<{ routines: RoutineDto[] }>('GET', '/api/routines'),
  addRoutine: (body: { name: string; startTime: string; durationMinutes: number; repeats: string }) =>
    request<{ routine: RoutineDto }>('POST', '/api/routines', { body }),
  deleteRoutine: (id: string) => request<void>('DELETE', `/api/routines/${id}`),

  feed: () => request<{ url: string }>('GET', '/api/feed'),
  rotateFeed: () => request<{ url: string }>('POST', '/api/feed/rotate'),

  shutdownPreview: () => request<ShutdownPreviewDto>('GET', '/api/shutdown/preview'),
  shutdown: () => request<ShutdownResultDto>('POST', '/api/shutdown', { body: {} }),

  members: () =>
    request<{ members: WorkspaceMemberDto[]; seats: SeatsDto }>('GET', '/api/workspace/members'),
  invite: (email: string) =>
    request<{ member: WorkspaceMemberDto; email?: 'sent' | 'queued'; billing?: 'queued' }>(
      'POST',
      '/api/workspace/invitations',
      { body: { email } },
    ),
  removeMember: (id: string) =>
    request<{ seats: SeatsDto }>('DELETE', `/api/workspace/members/${id}`),
  review: (week?: string) =>
    request<ReviewDto>('GET', week ? `/api/workspace/review?week=${week}` : '/api/workspace/review'),

  ops: () => request<{ workspaces: OpsWorkspaceDto[] }>('GET', '/api/ops/workspaces'),
};
