import type { PublishAddon, SyncAddon } from '../shared/addons';
import type { CandidateNote } from '../shared/boundary';
import type { DossierState } from '../shared/lifecycle';
import type { KeyEnvelope } from './crypto';

export interface Account {
  id: string;
  email: string;
  display_name: string;
  time_zone: string;
  operator: boolean;
}

export interface Device {
  id: string;
  name: string;
  approved: boolean;
  created_at: string;
}

export interface Vault {
  id: string;
  name: string;
  role: 'owner' | 'partner';
  created_at: string;
}

export interface Revision {
  rev: number;
  note_id: string;
  base_revision: number | null;
  ciphertext_sha256: string;
  byte_length: number;
  device_id: string;
  device_name: string;
  created_at: string;
  restored_from: number | null;
}

export interface PreviewLink {
  id: string;
  state: 'active' | 'revoked' | 'replaced' | 'expired';
  created_at: string;
  expires_at: string;
}

export interface Dossier {
  id: string;
  slug: string;
  root_note_id: string;
  state: DossierState;
  radius: number | null;
  public_count: number | null;
  severed_count: number | null;
  published_at: string | null;
  url: string;
  preview_link: PreviewLink | null;
}

export interface Plans {
  sync: SyncAddon;
  publish: PublishAddon;
}

export interface ManifestPreview {
  radius: number;
  public_count: number;
  severed_count: number;
  inside: { note_id: string; hop: number }[];
}

export interface ApiFailure {
  code: string;
  message: string;
  fields?: Record<string, string>;
  head_revision?: number | null;
  state?: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly failure: ApiFailure,
  ) {
    super(failure.message);
  }
}

export class NetworkError extends Error {}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    });
  } catch (error) {
    throw new NetworkError(error instanceof Error ? error.message : 'network request failed');
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const parsed = text.length > 0 ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    const failure = (parsed as { error?: ApiFailure } | null)?.error;
    throw new ApiError(response.status, failure ?? { code: 'unknown', message: 'Something went wrong.' });
  }
  return parsed as T;
}

export interface PushResult {
  revision: Revision;
  cursor: number;
}

export const api = {
  health: (): Promise<{ status: string }> => request('GET', '/api/health'),

  createAccount: (body: {
    email: string;
    password: string;
    display_name: string;
    time_zone: string;
    device_name: string;
  }): Promise<{ account: Account; device: Device }> => request('POST', '/api/accounts', body),

  signIn: (body: {
    email: string;
    password: string;
    device_name: string;
    device_id: string | null;
  }): Promise<{ account: Account; device: Device }> => request('POST', '/api/sessions', body),

  signOut: (): Promise<void> => request('DELETE', '/api/sessions/current'),

  me: (): Promise<{ account: Account; device: Device }> => request('GET', '/api/me'),

  devices: (): Promise<{ devices: Device[] }> => request('GET', '/api/devices'),

  approveDevice: (token: string): Promise<{ device: Device }> =>
    request('POST', `/api/device-approvals/${encodeURIComponent(token)}`),

  billing: (): Promise<Plans> => request('GET', '/api/billing'),

  addAddon: (addon: 'sync' | 'publish'): Promise<Plans> => request('POST', '/api/billing/subscriptions', { addon }),

  cancelAddon: (addon: 'sync' | 'publish'): Promise<Plans> =>
    request('DELETE', `/api/billing/subscriptions/${addon}`),

  createVault: (body: { name: string; key_envelope: KeyEnvelope }): Promise<{ vault: Vault }> =>
    request('POST', '/api/vaults', body),

  vaults: (): Promise<{ vaults: Vault[] }> => request('GET', '/api/vaults'),

  vault: (
    vaultId: string,
  ): Promise<{
    vault: Vault;
    key_envelope: KeyEnvelope;
    members: { display_name: string; role: string }[];
    head: number | null;
  }> => request('GET', `/api/vaults/${vaultId}`),

  invite: (vaultId: string, email: string): Promise<{ invite: { id: string; email: string; expires_at: string } }> =>
    request('POST', `/api/vaults/${vaultId}/invites`, { email }),

  acceptInvite: (token: string): Promise<{ vault: Vault }> =>
    request('POST', `/api/invites/${encodeURIComponent(token)}/accept`),

  push: (
    vaultId: string,
    noteId: string,
    body: { base_revision: number | null; ciphertext: string; ciphertext_sha256: string },
    idempotencyKey: string,
  ): Promise<PushResult> =>
    request('POST', `/api/vaults/${vaultId}/notes/${noteId}/revisions`, body, { 'Idempotency-Key': idempotencyKey }),

  restore: (
    vaultId: string,
    noteId: string,
    body: { revision: number; base_revision: number },
    idempotencyKey: string,
  ): Promise<PushResult> =>
    request('POST', `/api/vaults/${vaultId}/notes/${noteId}/restore`, body, { 'Idempotency-Key': idempotencyKey }),

  revisions: (
    vaultId: string,
    after: number,
  ): Promise<{ revisions: Revision[]; next_after: number; cursor: number }> =>
    request('GET', `/api/vaults/${vaultId}/revisions?after=${after}&limit=200`),

  blob: async (vaultId: string, rev: number): Promise<ArrayBuffer> => {
    let response: Response;
    try {
      response = await fetch(`/api/vaults/${vaultId}/revisions/${rev}/blob`, { credentials: 'same-origin' });
    } catch (error) {
      throw new NetworkError(error instanceof Error ? error.message : 'network request failed');
    }
    if (!response.ok) {
      const text = await response.text();
      const failure = (JSON.parse(text) as { error?: ApiFailure }).error;
      throw new ApiError(response.status, failure ?? { code: 'unknown', message: 'Something went wrong.' });
    }
    return response.arrayBuffer();
  },

  history: (vaultId: string, noteId: string): Promise<{ note_id: string; revisions: Revision[] }> =>
    request('GET', `/api/vaults/${vaultId}/notes/${noteId}/history`),

  dossiers: (): Promise<{ dossiers: Dossier[] }> => request('GET', '/api/dossiers'),

  createDossier: (body: { slug: string; root_note_id: string }): Promise<{ dossier: Dossier }> =>
    request('POST', '/api/dossiers', body),

  manifestPreview: (
    dossierId: string,
    body: { radius: number; notes: CandidateNote[] },
  ): Promise<ManifestPreview> => request('POST', `/api/dossiers/${dossierId}/manifest-preview`, body),

  publish: (dossierId: string, body: { radius: number; notes: CandidateNote[] }): Promise<{ dossier: Dossier }> =>
    request('POST', `/api/dossiers/${dossierId}/publish`, body),

  unpublish: (dossierId: string): Promise<{ dossier: Dossier }> =>
    request('POST', `/api/dossiers/${dossierId}/unpublish`),

  reopen: (dossierId: string): Promise<{ dossier: Dossier }> => request('POST', `/api/dossiers/${dossierId}/reopen`),

  createPreviewLink: (
    dossierId: string,
    body: { radius: number; notes: CandidateNote[] },
  ): Promise<{ preview_link: PreviewLink; url: string }> =>
    request('POST', `/api/dossiers/${dossierId}/preview-links`, body),

  revokePreviewLink: (dossierId: string, linkId: string): Promise<{ preview_link: PreviewLink }> =>
    request('DELETE', `/api/dossiers/${dossierId}/preview-links/${linkId}`),

  opsAccounts: (): Promise<{
    source: 'killbill' | 'cache';
    accounts: {
      account: Account;
      sync: SyncAddon | null;
      publish: PublishAddon | null;
      vault_count: number;
      blob_count: number;
      stored_bytes: number;
      live_dossiers: { slug: string; published_at: string | null }[];
    }[];
  }> => request('GET', '/api/ops/accounts'),

  sweep: (): Promise<{ warnings_sent: number; dossiers_taken_down: number; objects_removed: number }> =>
    request('POST', '/api/ops/sweep'),
};
