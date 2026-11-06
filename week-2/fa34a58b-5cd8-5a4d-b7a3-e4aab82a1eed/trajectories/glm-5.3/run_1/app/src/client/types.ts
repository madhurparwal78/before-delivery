// Shared client types mirroring the API records.
export interface StatusRoom { room_id: string; name: string; scene_id: string | null; scene_name: string | null; since: string | null; source: 'schedule' | 'guest' | 'none'; guest_scene_id: string | null }
export interface Status { now: string; day: string; zone: string; offset: string; rooms: StatusRoom[]; services: { storage: 'up' | 'down'; mail: 'up' | 'down' } }
export interface Room { id: string; name: string; order: number }
export interface Scene { id: string; name: string; tint: string; brightness: number; setpoint_f: number | null }
export interface Device { id: string; name: string; room_id: string; kind: 'light' | 'plug' | 'thermostat' | 'camera'; online: boolean; state: Record<string, unknown>; revision: number; updated_at: string }
export interface SchedSlot { id: string; time: string; scene_id: string; room_ids: string[] }
export interface Schedule { id: string; name: string; days: string; revision: number; versions: { from: string; slots: SchedSlot[] }[] }
export interface GuestScene { id: string; room_id: string; scene_id: string; starts_at: string; ends_at: string; state: 'scheduled' | 'active' | 'ended' | 'cancelled'; ended_at: string | null; cancelled_at: string | null }
export interface Run { id: string; schedule_id: string; version_from: string; slot_id: string; slot_time: string; ran_at: string; scene_id: string; room_ids: string[] }
export interface Clip { id: string; camera_id: string; camera_name: string; recorded_at: string; day: string; declared_size: number; stored_size: number | null; state: 'announced' | 'storing' | 'stored' | 'size_mismatch'; playable: boolean; object_key: string }
export interface Notice { id: string; kind: string; subject: string; to: string; state: 'queued' | 'sent'; attempts: number; created_at: string; sent_at: string | null }
export interface PlanChange { at: string; local: string; offset: string; source: 'schedule' | 'guest' | 'guest_end'; schedule_id: string | null; version_from: string | null; slot_id: string | null; slot_time: string | null; guest_scene_id: string | null; scene_id: string; room_ids: string[] }
export interface Plan { day: string; schedule_id: string; hours: number; start: string; end: string; hour_marks: { at: string; label: string; abbr: string }[]; rooms: { room_id: string; name: string; order: number }[]; start_owners: { room_id: string; scene_id: string | null; since: string | null; source: string; guest_scene_id: string | null }[]; changes: PlanChange[] }

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  const data = (await res.json()) as T & { error?: { code: string; message: string; fields?: Record<string, string> } };
  if (!res.ok) throw data;
  return data;
}

export interface ApiFailure { error: { code: string; message: string; fields?: Record<string, string> } }
export function isApiFailure(e: unknown): e is ApiFailure {
  return typeof e === 'object' && e !== null && 'error' in (e as object) && 'code' in (e as { error: object }).error;
}
