import type {
  Debrief, Invite, Me, PackPage, PlayPage, Placement, Prop, Room, RoomDetail, Session, TriggerNode, User, Version,
} from '../shared/types.js';

export interface ApiResult<T> {
  status: number;
  body: T | { error: string; errors?: Record<string, string>; [k: string]: unknown };
}

async function req<T>(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<ApiResult<T>> {
  const init: RequestInit = { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }, credentials: 'same-origin' };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(path, init);
  let data: unknown = null;
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) {
    data = await res.json().catch(() => null);
  } else if (res.status !== 204) {
    data = await res.text().catch(() => null);
  }
  return { status: res.status, body: data as T };
}

export const api = {
  get: <T>(p: string, h?: Record<string, string>) => req<T>('GET', p, undefined, h),
  post: <T>(p: string, b?: unknown, h?: Record<string, string>) => req<T>('POST', p, b, h),
  patch: <T>(p: string, b?: unknown, h?: Record<string, string>) => req<T>('PATCH', p, b, h),
  del: <T>(p: string, h?: Record<string, string>) => req<T>('DELETE', p, undefined, h),
  uploadProp: (form: FormData) => fetch('/api/props', { method: 'POST', body: form, credentials: 'same-origin' }),
};

export const isErr = <T>(r: ApiResult<T>): boolean =>
  r.status >= 400 || (r.body as { error?: string } | null)?.error !== undefined;

export function fieldErrors(body: unknown): Record<string, string> {
  const b = body as { errors?: Record<string, string> };
  return b?.errors ?? {};
}

/* ---- typed shortcuts ---- */
export async function fetchMe(): Promise<Me | null> {
  const r = await api.get<Me>('/api/me');
  return r.status === 200 ? (r.body as Me) : null;
}

export async function fetchRooms(): Promise<Room[]> {
  const r = await api.get<{ rooms: Room[] }>('/api/rooms');
  return r.status === 200 ? (r.body as { rooms: Room[] }).rooms : [];
}

export async function fetchRoom(roomId: string): Promise<RoomDetail | null> {
  const r = await api.get<RoomDetail>(`/api/rooms/${roomId}`);
  return r.status === 200 ? (r.body as RoomDetail) : null;
}

export async function fetchVersions(roomId: string): Promise<Version[]> {
  const r = await api.get<{ versions: Version[] }>(`/api/rooms/${roomId}/versions`);
  return r.status === 200 ? (r.body as { versions: Version[] }).versions : [];
}

export async function fetchProps(): Promise<Prop[]> {
  const r = await api.get<{ props: Prop[] }>('/api/props');
  return r.status === 200 ? (r.body as { props: Prop[] }).props : [];
}

export async function fetchPlaytests(roomId: string): Promise<Session[]> {
  const r = await api.get<{ sessions: Session[] }>(`/api/rooms/${roomId}/playtests`);
  return r.status === 200 ? (r.body as { sessions: Session[] }).sessions : [];
}

export async function fetchDebrief(sessionId: string): Promise<Debrief | null> {
  const r = await api.get<Debrief>(`/api/playtests/${sessionId}/debrief`);
  return r.status === 200 ? (r.body as Debrief) : null;
}

export async function fetchPlay(token: string): Promise<ApiResult<PlayPage>> {
  return req<PlayPage>('GET', `/api/play/${token}`);
}

export async function fetchPack(token: string): Promise<ApiResult<PackPage>> {
  return req<PackPage>('GET', `/api/pack/${token}`);
}

export type { Debrief, Invite, Me, PackPage, Placement, Prop, Room, RoomDetail, Session, TriggerNode, User, Version };
