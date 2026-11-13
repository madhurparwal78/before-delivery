// The published API from the browser's side. Same-origin fetches only.
import type { Account, AppConfig, BlobRecord, BlockEntry, Conversation, KeyBackup, Letter, LookupResult, RecoverResult, SealResult } from '../shared/types.js';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const text = await res.text();
  let parsed: unknown = null;
  if (text.length > 0) {
    try { parsed = JSON.parse(text); } catch { parsed = null; }
  }
  if (!res.ok) {
    const bodyObj = (parsed ?? {}) as Record<string, unknown>;
    throw new ApiError(res.status, String(bodyObj.error ?? 'unknown'), bodyObj);
  }
  return parsed as T;
}

export const api = {
  health: () => request<{ status: 'ok' | 'unavailable' }>('GET', '/api/health'),
  config: () => request<AppConfig>('GET', '/api/config'),
  availability: (username: string) => request<{ username: string; available: boolean; reason: string | null }>('GET', `/api/usernames/${encodeURIComponent(username)}/availability`),
  signUp: (body: { username: string; public_key: string; recovery_verifier: string; key_backup: { iv: string; ciphertext: string } }) =>
    request<Account>('POST', '/api/accounts', body),
  me: () => request<Account>('GET', '/api/me'),
  putProfile: (body: { iv: string; ciphertext: string; photo_blob_id: string | null }) => request<Account>('PUT', '/api/me/profile', body),
  patchSettings: (body: { read_receipts?: boolean; preview?: 'name_and_letter' | 'name_only' | 'none' }) => request<Account>('PATCH', '/api/me/settings', body),
  patchUsername: (body: { username: string }) => request<Account>('PATCH', '/api/me/username', body),
  recover: (body: { username: string; recovery_verifier: string; public_key: string; key_backup: { iv: string; ciphertext: string } }) =>
    request<RecoverResult>('POST', '/api/recover', body),
  lookup: (username: string) => request<LookupResult>('GET', `/api/lookup?username=${encodeURIComponent(username)}`),
  keysOf: (accountId: string) => request<{ keys: Array<{ key_id: string; public_key: string; created_at: string; current: boolean }> }>('GET', `/api/accounts/${accountId}/keys`),
  createConversation: (peerId: string) => request<Conversation>('POST', '/api/conversations', { peer_id: peerId }),
  conversations: (status: 'accepted' | 'request') => request<{ conversations: Conversation[] }>('GET', `/api/conversations?status=${status}`),
  conversation: (id: string) => request<Conversation>('GET', `/api/conversations/${id}`),
  accept: (id: string) => request<Conversation>('POST', `/api/conversations/${id}/accept`, {}),
  deleteRequest: (id: string) => request<void>('DELETE', `/api/conversations/${id}`),
  markRead: (id: string, throughSeq: number) => request<Conversation>('POST', `/api/conversations/${id}/read`, { through_seq: throughSeq }),
  mute: (id: string, duration: '1h' | '8h' | '1w' | 'always' | 'off') => request<Conversation>('PUT', `/api/conversations/${id}/mute`, { duration }),
  letters: (id: string, beforeSeq?: number, limit?: number) => {
    const params = new URLSearchParams();
    if (beforeSeq !== undefined) params.set('before_seq', String(beforeSeq));
    if (limit !== undefined) params.set('limit', String(limit));
    const qs = params.toString();
    return request<{ letters: Letter[] }>('GET', `/api/conversations/${id}/letters${qs ? `?${qs}` : ''}`);
  },
  postLetter: (body: { id: string; conversation_id: string; class: 'letter' | 'control'; recipient_key_id: string; iv: string | null; ciphertext: string | null; attachment_id?: string | null }) =>
    request<Letter>('POST', '/api/letters', body),
  letter: (id: string) => request<Letter>('GET', `/api/letters/${id}`),
  retract: (id: string) => request<Letter>('POST', `/api/letters/${id}/retract`, {}),
  inbox: () => request<{ letters: Letter[] }>('GET', '/api/inbox'),
  ackInbox: (throughSeq: number) => request<{ delivered: number }>('POST', '/api/inbox/ack', { through_seq: throughSeq }),
  declareBlob: (body: { id: string; kind: 'image' | 'file' | 'photo'; size: number }) => request<BlobRecord>('POST', '/api/blobs', body),
  uploadBlob: async (id: string, bytes: Uint8Array): Promise<BlobRecord> => {
    const res = await fetch(`/api/blobs/${id}/content`, {
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream' },
      body: bytes as unknown as BodyInit,
      credentials: 'same-origin',
    });
    const text = await res.text();
    if (!res.ok) {
      let code = 'unknown';
      try { code = String(JSON.parse(text).error); } catch { /* raw error body */ }
      throw new ApiError(res.status, code);
    }
    return JSON.parse(text) as BlobRecord;
  },
  downloadBlob: async (id: string): Promise<Uint8Array> => {
    const res = await fetch(`/api/blobs/${id}`, { credentials: 'same-origin' });
    if (!res.ok) {
      let code = 'unknown';
      try { code = String((await res.json()).error); } catch { /* raw error body */ }
      throw new ApiError(res.status, code);
    }
    return new Uint8Array(await res.arrayBuffer());
  },
  blocks: () => request<{ blocks: BlockEntry[] }>('GET', '/api/blocks'),
  block: (accountId: string) => request<BlockEntry>('PUT', `/api/blocks/${accountId}`, {}),
  unblock: (accountId: string) => request<void>('DELETE', `/api/blocks/${accountId}`),
  setSeal: (accountId: string, keyId: string, verified: boolean) => request<SealResult>('PUT', `/api/contacts/${accountId}/seal`, { key_id: keyId, verified }),
};
