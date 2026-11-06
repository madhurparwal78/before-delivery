import type { Account, Addon, Dossier, Device, Revision, VaultMeta, Note, Badge, } from './store';
import { encryptNote, sha256Hex, decryptNote, importRawKey } from './crypto';
import { get, save, uuid } from './store';
import type { Manifest } from '../shared/domain';
import { computeManifest } from '../shared/domain';
import type { NotePlain } from './crypto';

export interface ApiErrorShape {
  error: { code: string; message: string; fields?: Record<string, string>; [k: string]: unknown };
}

export class HttpError extends Error {
  status: number;
  code: string;
  fields?: Record<string, string>;
  extra?: Record<string, unknown>;
  constructor(status: number, body: ApiErrorShape['error'] | null) {
    super(body?.message ?? `Request failed (${status})`);
    this.status = status;
    this.code = body?.code ?? 'internal_error';
    this.fields = body?.fields;
    this.extra = body ? body as Record<string, unknown> : undefined;
  }
}

export const api = async <T>(method: string, path: string, body?: unknown, opts?: { idemKey?: string; rawBody?: string }): Promise<T> => {
  const headers: Record<string, string> = {};
  if (body !== undefined || opts?.rawBody) headers['Content-Type'] = 'application/json';
  if (opts?.idemKey) headers['Idempotency-Key'] = opts.idemKey;
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : opts?.rawBody,
    });
  } catch {
    throw new HttpError(0, null);
  }
  if (res.status === 204) return undefined as T;
  if (res.headers.get('content-type')?.startsWith('application/octet-stream')) {
    return (await res.arrayBuffer()) as unknown as T;
  }
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  if (!res.ok) {
    throw new HttpError(res.status, (json as ApiErrorShape | null)?.error ?? null);
  }
  return json as T;
};

// ---- session ----
export const me = () => api<{ account: Account; device: Device }>('GET', '/api/me');
export const listDevices = () => api<{ devices: Device[] }>('GET', '/api/devices');
export const signIn = (email: string, password: string, deviceName: string, deviceId: string | null) =>
  api<{ account: Account; device: Device }>('POST', '/api/sessions', { email, password, device_name: deviceName, device_id: deviceId });
export const signUp = (email: string, password: string, displayName: string, timeZone: string, deviceName: string) =>
  api<{ account: Account; device: Device }>('POST', '/api/accounts', { email, password, display_name: displayName, time_zone: timeZone, device_name: deviceName });
export const signOut = () => api<void>('DELETE', '/api/sessions/current');
export const approveDevice = (token: string) => api<{ device: Device }>('POST', `/api/device-approvals/${token}`);
export const billing = () => api<{ sync: Addon; publish: Addon }>('GET', '/api/billing');
export const addSubscription = (addon: 'sync' | 'publish') => api<{ sync: Addon; publish: Addon }>('POST', '/api/billing/subscriptions', { addon });
export const cancelSubscription = (addon: 'sync' | 'publish') => api<{ sync: Addon; publish: Addon }>('DELETE', `/api/billing/subscriptions/${addon}`);

// ---- vaults ----
export const listVaults = () => api<{ vaults: VaultMeta[] }>('GET', '/api/vaults');
export const createVault = (name: string, envelope: unknown) => api<{ vault: VaultMeta }>('POST', '/api/vaults', { name, key_envelope: envelope });
export const vaultInfo = (id: string) =>
  api<{ vault: VaultMeta; key_envelope: { salt: string; iterations: number; iv: string; wrapped_key: string }; members: { display_name: string; role: string }[]; head: number | null }>('GET', `/api/vaults/${id}`);
export const invite = (vaultId: string, email: string) => api<{ invite: { id: string; email: string; expires_at: string } }>('POST', `/api/vaults/${vaultId}/invites`, { email });
export const acceptInvite = (token: string) => api<{ vault: VaultMeta }>('POST', `/api/invites/${token}/accept`);

// ---- revisions ----
export const pullRevisions = async (vaultId: string, after: number, limit = 100): Promise<{ revisions: Revision[]; next_after: number | null; cursor: number }> =>
  api('GET', `/api/vaults/${vaultId}/revisions?after=${after}&limit=${limit}`);
export const blob = (vaultId: string, rev: number): Promise<ArrayBuffer> =>
  api('GET', `/api/vaults/${vaultId}/revisions/${rev}/blob`);
export const history = (vaultId: string, noteId: string) => api<{ note_id: string; revisions: Revision[] }>('GET', `/api/vaults/${vaultId}/notes/${noteId}/history`);
export const cursor = (vaultId: string) => api<{ device_id: string; cursor: number }>('GET', `/api/vaults/${vaultId}/cursor`);

export const pushNote = async (
  vaultId: string,
  noteId: string,
  note: NotePlain,
  baseRevision: number | null,
  rawKey: string,
  idemKey: string,
): Promise<{ revision: Revision; cursor: number }> => {
  const key = await importRawKey(rawKey);
  const blobBytes = await encryptNote(key, note);
  const sha = await sha256Hex(blobBytes);
  const b64Body = btoa(String.fromCharCode(...Array.from(blobBytes)));
  return api('POST', `/api/vaults/${vaultId}/notes/${noteId}/revisions`,
    { base_revision: baseRevision, ciphertext: b64Body, ciphertext_sha256: sha },
    { idemKey });
};

export const restoreRevision = (vaultId: string, noteId: string, revision: number, baseRevision: number, idemKey: string) =>
  api<{ revision: Revision; cursor: number }>('POST', `/api/vaults/${vaultId}/notes/${noteId}/restore`,
    { revision, base_revision: baseRevision }, { idemKey });

export const decryptBlob = async (rawKey: string, bytes: ArrayBuffer): Promise<NotePlain | null> => {
  const key = await importRawKey(rawKey);
  return decryptNote(key, new Uint8Array(bytes));
};

// ---- dossiers ----
export const listDossiers = () => api<{ dossiers: Dossier[] }>('GET', '/api/dossiers');
export const getDossier = (id: string) => api<{ dossier: Dossier }>('GET', `/api/dossiers/${id}`);
export const createDossier = (slug: string, rootNoteId: string) => api<{ dossier: Dossier }>('POST', '/api/dossiers', { slug, root_note_id: rootNoteId });
export const manifestPreview = (id: string, radius: number, notes: unknown[]) =>
  api<Manifest>('POST', `/api/dossiers/${id}/manifest-preview`, { radius, notes });
export const publishDossier = (id: string, radius: number, notes: unknown[]) =>
  api<{ dossier: Dossier }>('POST', `/api/dossiers/${id}/publish`, { radius, notes });
export const unpublishDossier = (id: string) => api<{ dossier: Dossier }>('POST', `/api/dossiers/${id}/unpublish`);
export const reopenDossier = (id: string) => api<{ dossier: Dossier }>('POST', `/api/dossiers/${id}/reopen`);
export const createPreviewLink = (id: string, radius: number, notes: unknown[]) =>
  api<{ preview_link: { id: string; state: string; created_at: string; expires_at: string }; url: string }>('POST', `/api/dossiers/${id}/preview-links`, { radius, notes });
export const revokePreviewLink = (id: string, linkId: string) =>
  api<{ preview_link: unknown }>('DELETE', `/api/dossiers/${id}/preview-links/${linkId}`);

// ---- ops ----
export interface OpsAccount {
  account: Account;
  sync: Addon;
  publish: Addon;
  vault_count: number;
  blob_count: number;
  stored_bytes: number;
  live_dossiers: { slug: string; published_at: string }[];
}
export const opsAccounts = () => api<{ source: 'killbill' | 'cache'; accounts: OpsAccount[] }>('GET', '/api/ops/accounts');
export const opsSweep = () => api<{ warnings_sent: number; dossiers_taken_down: number; objects_removed: number }>('POST', '/api/ops/sweep');

// ---- boundary helpers ----
export const noteToCandidate = (n: Note) => ({
  id: n.id, title: n.title, aliases: n.aliases, frontmatter: n.frontmatter, body: n.body, private: n.private,
});

/** Candidates for the boundary: every non-private note within hop 4 of the root. */
export const candidatesFor = (notes: Note[], rootId: string): Note[] => {
  const root = notes.find((n) => n.id === rootId);
  if (!root) return [];
  const reachable = computeManifest({ radius: 4, notes: notes.map(noteToCandidate) });
  const ids = new Set(reachable.inside.map((i) => i.note_id));
  const withRoot = [root, ...notes.filter((n) => ids.has(n.id) && n.id !== rootId)];
  return withRoot;
};

export const badgeFor = (noteId: string): Badge => get().badges[noteId] ?? 'local only';

export const setBadge = (noteId: string, badge: Badge): void => {
  const badges = { ...get().badges, [noteId]: badge };
  save({ badges });
};

export const newNoteObject = (title = ''): Note => ({
  id: uuid(), title, aliases: [], frontmatter: {}, body: '', private: false, createdAt: Date.now(),
});

export { uuid };
