import type { Account, AppConfig, ApiError, Classroom, ClassroomExport, Export, Project, StudentClassroomView } from '../shared/types.js';

export interface ApiFailure {
  ok: false;
  status: number;
  error: ApiError;
}

export interface ApiSuccess<T> {
  ok: true;
  status: number;
  data: T;
}

export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

export async function api<T>(path: string, init?: RequestInit & { idempotencyKey?: string; raw?: boolean }): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {};
  if (init?.idempotencyKey) headers['Idempotency-Key'] = init.idempotencyKey;
  if (init?.body && !init.raw) headers['Content-Type'] = 'application/json';
  try {
    const res = await fetch(path, { ...init, headers, credentials: 'same-origin' });
    if (res.status === 204) return { ok: true, status: 204, data: undefined as T };
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, status: res.status, error: data as ApiError };
    return { ok: true, status: res.status, data: data as T };
  } catch {
    return { ok: false, status: 0, error: { error: 'network', message: 'Not found.' } };
  }
}

export async function apiRaw(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data?: ArrayBuffer; error?: ApiError; headers?: Headers }> {
  try {
    const res = await fetch(path, { ...init, credentials: 'same-origin' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'unknown', message: 'Not found.' }));
      return { ok: false, status: res.status, error: err as ApiError };
    }
    const data = await res.arrayBuffer();
    return { ok: true, status: res.status, data, headers: res.headers };
  } catch {
    return { ok: false, status: 0, error: { error: 'network', message: 'Not found.' } };
  }
}

export const getJson = <T>(path: string) => api<T>(path);

export const postJson = <T>(path: string, body: unknown, idempotencyKey?: string) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(body), idempotencyKey });

export const putJson = <T>(path: string, body: unknown, idempotencyKey?: string) =>
  api<T>(path, { method: 'PUT', body: JSON.stringify(body), idempotencyKey });

export const patchJson = <T>(path: string, body: unknown) =>
  api<T>(path, { method: 'PATCH', body: JSON.stringify(body) });

export const deleteJson = <T>(path: string) => api<T>(path, { method: 'DELETE' });

export interface SessionResponse { account: Account | null; pendingJoin: { classroomName: string } | null }

export const loadSession = () => api<SessionResponse>('/api/session');
export const loadConfig = () => api<AppConfig>('/api/config');
export const loadClassrooms = () => api<{ classrooms: Classroom[] }>('/api/classrooms');
export const loadClassroom = (id: string) => api<Classroom>(`/api/classrooms/${id}`);
export const loadClassView = () => api<StudentClassroomView>('/api/class');
export const loadProjects = () => api<{ projects: Project[] }>('/api/projects');
export const loadExports = () => api<{ exports: Export[] }>('/api/exports');
export const loadClassroomExports = (id: string) => api<{ exports: ClassroomExport[] }>(`/api/classrooms/${id}/exports`);
