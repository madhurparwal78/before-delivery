import type { ErrorCode } from '../shared/copy.js';
import type {
  Account,
  Classroom,
  ClientConfig,
  ExportRecord,
  Project,
  SessionInfo,
  Snapshot,
  StudentClassroomView,
} from '../shared/types.js';

export interface ApiFailure {
  ok: false;
  status: number;
  code: ErrorCode;
  message: string;
  fields?: Record<string, string>;
  currentRevision?: number;
  retryAfterSeconds?: number;
}

export interface ApiSuccess<T> {
  ok: true;
  status: number;
  value: T;
}

export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

const request = async <T>(
  method: string,
  path: string,
  options: { json?: unknown; body?: BodyInit; headers?: Record<string, string> } = {},
): Promise<ApiResult<T>> => {
  const headers: Record<string, string> = { ...options.headers };
  let body: BodyInit | undefined;
  if (options.json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.json);
  } else if (options.body !== undefined) {
    body = options.body;
  }
  let response: Response;
  try {
    response = await fetch(path, { method, headers, body, credentials: 'same-origin' });
  } catch {
    return { ok: false, status: 0, code: 'storage_unavailable', message: 'Storage is unavailable. Try again in a minute.' };
  }
  if (response.status === 204) return { ok: true, status: 204, value: undefined as T };
  const text = await response.text();
  const parsed: unknown = text === '' ? {} : JSON.parse(text);
  if (!response.ok) {
    const failure = parsed as {
      error: ErrorCode;
      message: string;
      fields?: Record<string, string>;
      currentRevision?: number;
      retryAfterSeconds?: number;
    };
    return {
      ok: false,
      status: response.status,
      code: failure.error,
      message: failure.message,
      fields: failure.fields,
      currentRevision: failure.currentRevision,
      retryAfterSeconds: failure.retryAfterSeconds,
    };
  }
  return { ok: true, status: response.status, value: parsed as T };
};

export const api = {
  session: () => request<SessionInfo>('GET', '/api/session'),
  config: () => request<ClientConfig>('GET', '/api/config'),
  signup: (input: { email: string; password: string; displayName: string; accountType: 'educator' | 'personal' }) =>
    request<{ account: Account; verificationEmailSent: boolean }>('POST', '/api/auth/signup', { json: input }),
  signin: (input: { email: string; password: string }) =>
    request<{ account: Account }>('POST', '/api/auth/signin', { json: input }),
  signout: () => request<void>('POST', '/api/auth/signout'),
  verify: (token: string) => request<{ account: Account }>('POST', '/api/auth/verify', { json: { token } }),
  resendVerification: () => request<{ sentTo: string }>('POST', '/api/auth/resend-verification'),

  joinCode: (code: string) => request<{ classroom: { name: string } }>('POST', '/api/join/code', { json: { code } }),
  joinNickname: (nickname: string) => request<{ account: Account }>('POST', '/api/join/nickname', { json: { nickname } }),
  studentClass: () => request<StudentClassroomView>('GET', '/api/class'),

  classrooms: () => request<{ classrooms: Classroom[] }>('GET', '/api/classrooms'),
  createClassroom: (input: {
    name: string;
    timeZone: string;
    joinOpensLocal?: string;
    joinClosesLocal?: string;
    handInLocal?: string;
  }) => request<Classroom>('POST', '/api/classrooms', { json: input }),
  classroom: (id: string) => request<Classroom>('GET', `/api/classrooms/${id}`),
  patchClassroom: (id: string, input: Record<string, string>) =>
    request<Classroom>('PATCH', `/api/classrooms/${id}`, { json: input }),
  newJoinCode: (id: string) => request<{ joinCode: string }>('POST', `/api/classrooms/${id}/join-code`),
  handInClassroom: (id: string) => request<Classroom>('POST', `/api/classrooms/${id}/hand-in`),
  archiveClassroom: (id: string) => request<Classroom>('POST', `/api/classrooms/${id}/archive`),
  renameStudent: (id: string, studentId: string, nickname: string) =>
    request<{ id: string; nickname: string }>('PATCH', `/api/classrooms/${id}/students/${studentId}`, { json: { nickname } }),
  removeStudent: (id: string, studentId: string) =>
    request<void>('DELETE', `/api/classrooms/${id}/students/${studentId}`),
  addEducator: (id: string, email: string) =>
    request<{ id: string; displayName: string; email: string; role: 'assistant' }>(
      'POST',
      `/api/classrooms/${id}/educators`,
      { json: { email } },
    ),
  removeEducator: (id: string, educatorId: string) =>
    request<void>('DELETE', `/api/classrooms/${id}/educators/${educatorId}`),
  classroomExports: (id: string) =>
    request<{ exports: (ExportRecord & { nickname: string })[] }>('GET', `/api/classrooms/${id}/exports`),

  projects: () => request<{ projects: Project[] }>('GET', '/api/projects'),
  createProject: (input: { kind: string; name: string; snapshot: Snapshot }) =>
    request<{ project: Project }>('POST', '/api/projects', { json: input }),
  project: (id: string) => request<{ project: Project; snapshot: Snapshot }>('GET', `/api/projects/${id}`),
  saveProject: (id: string, input: { baseRevision: number; snapshot: Snapshot; name?: string }, idempotencyKey?: string) =>
    request<{ project: Project }>('PUT', `/api/projects/${id}`, {
      json: input,
      headers: idempotencyKey ? { 'idempotency-key': idempotencyKey } : {},
    }),
  handInProject: (id: string) => request<{ project: Project }>('POST', `/api/projects/${id}/hand-in`),

  exports: () => request<{ exports: ExportRecord[] }>('GET', '/api/exports'),
  uploadExport: (
    params: { format: string; unit: string; name: string; projectId?: string | null },
    bytes: Uint8Array,
  ) => {
    const search = new URLSearchParams({ format: params.format, unit: params.unit, name: params.name });
    if (params.projectId) search.set('projectId', params.projectId);
    return request<ExportRecord>('POST', `/api/exports?${search.toString()}`, {
      body: new Blob([bytes as BlobPart], { type: 'application/octet-stream' }),
      headers: { 'content-type': 'application/octet-stream' },
    });
  },
};
