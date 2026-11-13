declare global {
  interface Window {
    __lwLocale?: string;
    __lwKind?: string;
    __lwSignedIn?: boolean;
    __lwSuppress?: boolean;
  }
}

export {};

export async function api<T>(method: string, path: string, body?: unknown, opts: { raw?: boolean } = {}): Promise<{ status: number; data: T | null; retryAfter?: string | null }> {
  const headers: Record<string, string> = {};
  let payload: BodyInit | undefined;
  if (body !== undefined && !opts.raw) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  } else if (opts.raw && body instanceof Blob) {
    payload = body;
  }
  const init: RequestInit = { method, headers, credentials: 'same-origin' };
  if (payload !== undefined) init.body = payload;
  const res = await fetch(path, init);
  const contentType = res.headers.get('content-type') ?? '';
  const data = contentType.includes('json') ? await res.json().catch(() => null) : null;
  return { status: res.status, data: data as T | null, retryAfter: res.headers.get('retry-after') };
}

export async function getJson<T>(path: string): Promise<T | null> {
  const res = await api<T>('GET', path);
  if (res.status !== 200) return null;
  return res.data;
}

export type Account = {
  id: string;
  email: string;
  display_name: string;
  locale: string;
  email_verified: boolean;
  verification_email: 'sent' | 'not_sent';
  storage_notice: 'upload_unavailable' | 'delete_unavailable' | null;
};

export type Character = {
  id: string;
  slot: number;
  revision: number;
  name: string;
  parts: Record<string, string>;
  proportions: Record<string, number>;
  pose: { right_arm_raise: number };
  material: string;
  accessories: Record<string, string>;
  model_id: string | null;
  weapon_id: string | null;
  equipped: boolean;
};

export type Stats = { reach_m: number; weight_kg: number; swing_per_s: number };

export type Weapon = {
  id: string;
  number: number;
  strokes: { thickness: number; points: [number, number][] }[];
  stats: Stats;
  vertices: number;
  equipped_on: string[];
};

export type RuleResult = {
  id: string;
  status: 'pass' | 'fail' | 'skipped';
  measured: number | string | [number, number, number, number] | null;
  limit: number | null;
};

export type Report = { rulebook_version: string; failed_count: number; rules: RuleResult[] };

export type Model = {
  id: string;
  filename: string;
  size_bytes: number;
  sha256: string;
  status: 'stored' | 'validating' | 'accepted' | 'equipped' | 'rejected';
  rulebook_version: string | null;
  report: Report | null;
  created_at: string;
};

export type Progress = {
  unlocked_chapter: number;
  completed_chapters: number[];
  checkpoint: { chapter: number; motes: string[] } | null;
};

export type Story = { id: string; mode: 'solo' | 'coop'; title: string; chapters: number; progress: Progress | null };

export type PartyMember = {
  account_id: string;
  display_name: string;
  joined_at: string;
  connection: 'connected' | 'dropped' | 'offline';
  grace_remaining_seconds: number | null;
};

export type ReadyCheck = {
  deadline_at: number;
  remaining_seconds: number;
  responses: Record<string, 'ready' | 'not_ready' | 'pending'>;
};

export type Party = {
  id: string;
  status: 'forming' | 'ready_check' | 'in_session' | 'member_dropped' | 'chapter_complete';
  leader_id: string;
  story_id: string;
  members: PartyMember[];
  ready_check: ReadyCheck | null;
  session_id: string | null;
  progress: Progress | null;
};

export type ChatMessage = {
  id: string;
  seq: number;
  kind: 'user' | 'system';
  author: { account_id: string; display_name: string } | null;
  body: string | null;
  code: string | null;
  params: Record<string, string>;
  text: string;
  created_at: string;
};

export type FriendEntry = { account_id: string; display_name: string; presence: 'online' | 'offline' };
export type FriendRequest = { id: string; from: { account_id: string; display_name: string }; to: { account_id: string; display_name: string }; created_at: string };

export type Invite = { token: string; party_id: string; from: { account_id: string; display_name: string }; story_id: string; member_count: number };

export type SessionSnapshot = {
  id: string;
  story_id: string;
  chapter: number;
  mode: string;
  status: 'running' | 'complete';
  tick: number;
  gate_open: boolean;
  checkpoint_reached: boolean;
  motes: { id: string; x: number; z: number; collected_by: string | null }[];
  members: {
    account_id: string;
    display_name: string;
    status: 'connected' | 'dropped';
    grace_remaining_seconds: number | null;
    position: { x: number; z: number };
    health: number;
    hero: Record<string, unknown>;
    weapon: { strokes: { thickness: number; points: [number, number][] }[]; stats: Stats } | null;
    model_url: string | null;
  }[];
};

export type ApiError = { error: { code: string; message: string; fields?: Record<string, string> } };

export async function setLocale(value: string): Promise<void> {
  await api('PUT', '/api/locale', { locale: value });
}
