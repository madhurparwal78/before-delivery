import { get } from './api.js';
import type { Role } from '../shared/types.js';

export interface Me {
  user: { id: string; username: string };
  projects: { id: string; name: string; role: Role }[];
}

interface Config {
  formula_max_chars: number;
  formula_max_depth: number;
  mark_max: number;
  formula_debounce_ms: number;
  row_max: number;
  csv_max_bytes: number;
  sse_heartbeat_ms: number;
}

export const session: { me: Me | null; config: Config | null; serverNow: number; unread: number } = {
  me: null,
  config: null,
  serverNow: 0,
  unread: 0,
};

export async function loadConfig(): Promise<void> {
  const res = await get<Config>('/api/config');
  if (res.status === 200) session.config = res.data;
}

export async function loadMe(): Promise<void> {
  const res = await get<Me>('/api/me');
  session.me = res.status === 200 ? res.data : null;
}

export async function loadServerTime(): Promise<void> {
  const res = await get<{ server_now: string }>('/api/time');
  if (res.status === 200) session.serverNow = Date.parse(res.data.server_now);
}

export function roleIn(projectId: string): Role | null {
  return session.me?.projects.find((p) => p.id === projectId)?.role ?? null;
}

export function debounceMs(): number {
  return session.config?.formula_debounce_ms ?? 300;
}
