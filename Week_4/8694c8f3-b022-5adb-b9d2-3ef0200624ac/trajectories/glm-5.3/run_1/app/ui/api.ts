export interface UserInfo { id: string; email: string; display_name: string }

export interface LayerDoc {
  id: string;
  parent_id: string | null;
  index: number;
  name: string;
  kind: 'group' | 'cube' | 'sphere' | 'plane' | 'torus' | 'tube' | 'camera' | 'light' | 'model' | 'shader';
  version: number;
  visible: boolean;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  props: Record<string, number>;
  material: { tint: [number, number, number]; tint_alpha: number; albedo_texture_id: string | null; emissive_texture_id: string | null } | null;
  model_asset_id: string | null;
  output_buses: string[];
  shader_version: number | null;
  shader_source?: string;
}

export interface KeyDoc { layer_id: string; property: string; tick: number; value: number }

export interface GraphNode { node_id: string; type: string; params: Record<string, unknown>; x: number; y: number }
export interface GraphWire { wire_id: string; from: { node_id: string; port: string }; to: { node_id: string; port: string } }
export interface GraphDoc { version: number; nodes: GraphNode[]; wires: GraphWire[] }

export interface ScriptDoc { id: string; name: string; version: number; source: string; asset_ids: string[] }

export interface SetDoc {
  set: {
    id: string; name: string; bpm: number; head: number; settings_version: number; graph_version: number;
    active_camera_id: string | null; show_token: string; role: 'owner' | 'editor' | 'viewer';
  };
  layers: LayerDoc[];
  keys: KeyDoc[];
  graph: GraphDoc;
  scripts: ScriptDoc[];
}

export interface SetSummary { id: string; name: string; role: string; bpm: number; head: number; live_number: number | null }

export interface AssetDoc {
  id: string; name: string; kind: 'model' | 'texture'; size: number; sha256: string; status: 'ready' | 'uploading' | 'upload failed';
  created_at: string;
  dependents: { count: number; layers: { id: string; name: string }[]; materials: { layer_id: string; name: string }[]; scripts: { id: string; name: string }[] };
}

export interface ShaderVersion { number: number; sha256: string; size: number; author: { user_id: string; display_name: string }; created_at: string; restored_from: number | null }

export interface ShowVersion { number: number; status: 'storing' | 'published' | 'store failed'; live: boolean; sha256: string | null; size: number | null; published_at: string | null; published_by: { user_id: string; display_name: string } | null; note: string | null }

export interface ActivityEntry { id: string; at: string; actor: { user_id: string; display_name: string }; action: string; target: string; summary: string }

export interface OpEvent {
  seq: number;
  client_op_id?: string;
  actor?: { user_id: string; display_name: string };
  target: string;
  type: string;
  payload: Record<string, unknown>;
  committed_at?: string;
}

export interface LockEvent { layer_id: string; holder: { user_id: string; display_name: string } | null; expires_at: string | null; reason: 'granted' | 'renewed' | 'released' | 'expired' }

export interface PresenceMember { user_id: string; display_name: string; colour: string; selection: string | null }

export interface ApiErrorShape {
  code: string;
  message: string;
  fields?: Record<string, string>;
  current_version?: number;
  current?: unknown;
  changed_by?: { user_id: string; display_name: string };
  holder?: { user_id: string; display_name: string };
  expires_at?: string;
  dependents?: AssetDoc['dependents'];
  show_versions?: number[];
}

export class ApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorShape;
  constructor (status: number, body: ApiErrorShape) {
    super(body.message);
    this.status = status;
    this.body = body;
  }
}

export type NetworkResult<T> = { ok: true; status: number; body: T } | { ok: false; status: number; body: unknown; error: ApiError };

async function request<T>(method: string, path: string, body?: unknown): Promise<NetworkResult<T>> {
  try {
    const response = await fetch(path, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
    if (response.status === 204) return { ok: true, status: 204, body: undefined as T };
    const text = await response.text();
    const parsed = text === '' ? undefined : JSON.parse(text);
    if (response.status >= 400) {
      return { ok: false, status: response.status, body: parsed, error: new ApiError(response.status, parsed?.error ?? { code: 'unknown', message: 'Request failed' }) };
    }
    return { ok: true, status: response.status, body: parsed as T };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new OfflineError();
  }
}

export class OfflineError extends Error {
  constructor () { super('offline'); }
}

export const api = {
  async get<T>(path: string): Promise<NetworkResult<T>> { return await request<T>('GET', path); },
  async post<T>(path: string, body?: unknown): Promise<NetworkResult<T>> { return await request<T>('POST', path, body); },
  async del<T>(path: string): Promise<NetworkResult<T>> { return await request<T>('DELETE', path); },
  async upload (path: string, formData: FormData): Promise<NetworkResult<unknown>> {
    try {
      const response = await fetch(path, { method: 'POST', body: formData, credentials: 'same-origin' });
      const parsed = (await response.json()) as { error?: ApiErrorShape } & Record<string, unknown>;
      if (response.status >= 400) {
        return { ok: false, status: response.status, body: parsed, error: new ApiError(response.status, parsed?.error ?? { code: 'unknown', message: 'Upload failed' }) };
      }
      return { ok: true, status: response.status, body: parsed };
    } catch {
      throw new OfflineError();
    }
  },
};
