import type {
  ActivityEntry,
  AssetDoc,
  LockDoc,
  OpDoc,
  OpResult,
  PresenceMember,
  Role,
  SetDocument,
  SetSummary,
  ShaderVersionSummary,
  ShowVersionDoc,
  UserDoc,
} from '../shared/types.js';

export interface ApiErrorBody {
  code: string;
  message: string;
  fields?: Record<string, string>;
  holder?: { user_id: string; display_name: string };
  changed_by?: { user_id: string; display_name: string };
  current_version?: number;
  current?: unknown;
  dependents?: AssetDoc['dependents'];
  show_versions?: number[];
}

export class ApiFailure extends Error {
  readonly status: number;
  readonly body: ApiErrorBody;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.status = status;
    this.body = body;
  }
}

export class NetworkFailure extends Error {}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    });
  } catch {
    throw new NetworkFailure('The connection failed');
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const parsed: unknown = text === '' ? {} : JSON.parse(text);
  if (!response.ok) {
    const envelope = parsed as { error?: ApiErrorBody };
    throw new ApiFailure(response.status, envelope.error ?? { code: 'unknown', message: 'Request failed' });
  }
  return parsed as T;
}

async function upload<T>(path: string, form: FormData): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { method: 'POST', body: form, credentials: 'same-origin' });
  } catch {
    throw new NetworkFailure('The connection failed');
  }
  const text = await response.text();
  const parsed: unknown = text === '' ? {} : JSON.parse(text);
  if (!response.ok) {
    const envelope = parsed as { error?: ApiErrorBody };
    throw new ApiFailure(response.status, envelope.error ?? { code: 'unknown', message: 'Upload failed' });
  }
  return parsed as T;
}

export interface OpRequest {
  client_op_id: string;
  target: string;
  base_version?: number | null;
  type: string;
  payload: Record<string, unknown>;
}

export const api = {
  signup: (email: string, password: string, display_name: string) =>
    request<{ user: UserDoc }>('POST', '/api/auth/signup', { email, password, display_name }),
  login: (email: string, password: string) =>
    request<{ user: UserDoc }>('POST', '/api/auth/login', { email, password }),
  logout: () => request<void>('POST', '/api/auth/logout'),
  me: () => request<{ user: UserDoc }>('GET', '/api/me'),

  listSets: () => request<{ sets: SetSummary[] }>('GET', '/api/sets'),
  createSet: (name: string) => request<SetDocument>('POST', '/api/sets', { name, starter: 'blank-stage' }),
  getSet: (setId: string) => request<SetDocument>('GET', `/api/sets/${setId}`),
  sendOp: (setId: string, op: OpRequest) => request<OpResult>('POST', `/api/sets/${setId}/ops`, op),
  listOps: (setId: string, after: number) =>
    request<{ ops: OpDoc[]; head: number }>('GET', `/api/sets/${setId}/ops?after=${after}`),

  listMembers: (setId: string) =>
    request<{ members: { user_id: string; display_name: string; email: string; role: Role }[] }>(
      'GET',
      `/api/sets/${setId}/members`,
    ),
  createInvite: (setId: string, role: Role) =>
    request<{ token: string; url: string; role: Role }>('POST', `/api/sets/${setId}/invites`, { role }),
  getInvite: (token: string) =>
    request<{ set_name: string; role: Role; owner_display_name: string; used: boolean }>(
      'GET',
      `/api/invites/${token}`,
    ),
  acceptInvite: (token: string) =>
    request<{ set_id: string; role: Role }>('POST', `/api/invites/${token}/accept`),

  takeLock: (setId: string, layerId: string) =>
    request<{ layer_id: string; holder: { user_id: string; display_name: string }; expires_at: string }>(
      'POST',
      `/api/sets/${setId}/layers/${layerId}/lock`,
    ),
  heartbeatLock: (setId: string, layerId: string) =>
    request<{ layer_id: string; expires_at: string }>(
      'POST',
      `/api/sets/${setId}/layers/${layerId}/lock/heartbeat`,
    ),
  releaseLock: (setId: string, layerId: string) =>
    request<void>('DELETE', `/api/sets/${setId}/layers/${layerId}/lock`),
  listLocks: (setId: string) =>
    request<{ server_time: string; locks: LockDoc[] }>('GET', `/api/sets/${setId}/locks`),
  postPresence: (setId: string, selection: string | null) =>
    request<{ members: PresenceMember[] }>('POST', `/api/sets/${setId}/presence`, { selection }),

  listAssets: (setId: string) => request<{ assets: AssetDoc[] }>('GET', `/api/sets/${setId}/assets`),
  uploadAsset: (setId: string, kind: 'model' | 'texture', file: File) => {
    const form = new FormData();
    form.append('kind', kind);
    form.append('file', file);
    return upload<{ asset: AssetDoc }>(`/api/sets/${setId}/assets`, form);
  },
  deleteAsset: (setId: string, assetId: string) =>
    request<void>('DELETE', `/api/sets/${setId}/assets/${assetId}`),

  listShaderVersions: (setId: string, layerId: string) =>
    request<{ versions: ShaderVersionSummary[] }>(
      'GET',
      `/api/sets/${setId}/layers/${layerId}/shader/versions`,
    ),
  getShaderVersion: (setId: string, layerId: string, number: number) =>
    request<{ number: number; source: string; sha256: string }>(
      'GET',
      `/api/sets/${setId}/layers/${layerId}/shader/versions/${number}`,
    ),

  publishShow: (setId: string, note: string) =>
    request<{ show_version: ShowVersionDoc }>('POST', `/api/sets/${setId}/shows`, { note }),
  listShows: (setId: string) =>
    request<{ show_url: string; live_number: number | null; versions: ShowVersionDoc[] }>(
      'GET',
      `/api/sets/${setId}/shows`,
    ),
  rollbackShow: (setId: string) =>
    request<{ live_number: number; previous_live_number: number | null }>(
      'POST',
      `/api/sets/${setId}/shows/rollback`,
    ),
  activateShow: (setId: string, number: number) =>
    request<{ live_number: number; previous_live_number: number | null }>(
      'POST',
      `/api/sets/${setId}/shows/${number}/activate`,
    ),

  createExport: (setId: string) =>
    request<{ export: { id: string; sha256: string; size: number; download_url: string } }>(
      'POST',
      `/api/sets/${setId}/exports`,
    ),
  importSet: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return upload<SetDocument>('/api/sets/import', form);
  },

  listActivity: (setId: string) =>
    request<{ entries: ActivityEntry[] }>('GET', `/api/sets/${setId}/activity`),
  status: () => request<{ storage: string; collab: string }>('GET', '/api/status'),
  showInfo: (token: string) =>
    request<{
      set_name: string;
      bpm: number;
      version: { number: number; sha256: string; size: number; published_at: string };
    }>('GET', `/api/show/${token}`),
};

export function newClientOpId(): string {
  return `op-${crypto.randomUUID()}`;
}
