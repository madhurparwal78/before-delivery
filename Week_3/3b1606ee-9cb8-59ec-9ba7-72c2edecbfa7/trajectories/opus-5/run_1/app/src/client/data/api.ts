import type {
  AccountRecord,
  AvailabilityRecord,
  BlobRecord,
  BlockRecord,
  ConfigRecord,
  ConversationRecord,
  ConversationStatus,
  KeyBackupRecord,
  KeyRecord,
  LetterRecord,
  LookupRecord,
  MuteDuration,
  PreviewSetting,
  SealedProfile,
  SealStatus,
} from '../../shared/types.js';

export class ApiFailure extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string>;
  readonly extra: Record<string, unknown>;

  constructor(status: number, body: Record<string, unknown>) {
    super(typeof body['error'] === 'string' ? body['error'] : 'request_failed');
    this.name = 'ApiFailure';
    this.status = status;
    this.code = typeof body['error'] === 'string' ? body['error'] : 'request_failed';
    this.fields = (body['fields'] as Record<string, string>) ?? {};
    this.extra = body;
  }
}

/** A network failure, not an answer from the exchange. */
export class Offline extends Error {
  constructor() {
    super('offline');
    this.name = 'Offline';
  }
}

type StorageListener = (unavailable: boolean) => void;
const storageListeners = new Set<StorageListener>();
const sessionListeners = new Set<() => void>();

/** A revoked browser learns of it from the first answer that refuses its session. */
export function onUnauthenticated(listener: () => void): void {
  sessionListeners.add(listener);
}

export function onStorageOutage(listener: StorageListener): void {
  storageListeners.add(listener);
}

function announceStorage(unavailable: boolean): void {
  for (const listener of storageListeners) listener(unavailable);
}

interface CallOptions {
  method?: string;
  body?: unknown;
  raw?: Uint8Array;
  expectBytes?: boolean;
  /** Calls that reach object storage; only these clear the outage banner. */
  storage?: boolean;
}

async function call<T>(path: string, options: CallOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (options.raw !== undefined) {
    headers['content-type'] = 'application/octet-stream';
    body = options.raw as BodyInit;
  } else if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(path, { method, headers, body, credentials: 'same-origin' });
  } catch {
    throw new Offline();
  }

  if (response.status === 204) {
    return undefined as T;
  }

  if (options.expectBytes && response.ok) {
    announceStorage(false);
    return new Uint8Array(await response.arrayBuffer()) as T;
  }

  const text = await response.text();
  const payload = text === '' ? {} : (JSON.parse(text) as Record<string, unknown>);
  if (!response.ok) {
    const failure = new ApiFailure(response.status, payload);
    if (failure.code === 'storage_unavailable') announceStorage(true);
    if (failure.status === 401) for (const listener of sessionListeners) listener();
    throw failure;
  }
  if (options.storage === true) announceStorage(false);
  return payload as T;
}

export const api = {
  health: async () => {
    const result = await call<{ status: 'ok' | 'unavailable' }>('/api/health');
    announceStorage(result.status !== 'ok');
    return result;
  },
  config: () => call<ConfigRecord>('/api/config'),
  availability: (username: string) =>
    call<AvailabilityRecord>(`/api/usernames/${encodeURIComponent(username)}/availability`),
  createAccount: (body: {
    username: string;
    public_key: string;
    recovery_verifier: string;
    key_backup: { iv: string; ciphertext: string };
  }) => call<AccountRecord>('/api/accounts', { method: 'POST', body }),
  me: () => call<AccountRecord>('/api/me'),
  saveProfile: (body: SealedProfile) =>
    call<AccountRecord>('/api/me/profile', {
      method: 'PUT',
      body,
      storage: body.photo_blob_id !== null,
    }),
  saveSettings: (body: { read_receipts?: boolean; preview?: PreviewSetting }) =>
    call<AccountRecord>('/api/me/settings', { method: 'PATCH', body }),
  changeUsername: (username: string) =>
    call<AccountRecord>('/api/me/username', { method: 'PATCH', body: { username } }),
  recover: (body: {
    username: string;
    recovery_verifier: string;
    public_key: string;
    key_backup: { iv: string; ciphertext: string };
  }) =>
    call<{ account: AccountRecord; key_backups: KeyBackupRecord[] }>('/api/recover', {
      method: 'POST',
      body,
    }),
  lookup: (username: string) =>
    call<LookupRecord>(`/api/lookup?username=${encodeURIComponent(username)}`),
  keys: (accountId: string) => call<{ keys: KeyRecord[] }>(`/api/accounts/${accountId}/keys`),
  startConversation: (peerId: string) =>
    call<ConversationRecord>('/api/conversations', { method: 'POST', body: { peer_id: peerId } }),
  conversations: (status: ConversationStatus) =>
    call<{ conversations: ConversationRecord[] }>(`/api/conversations?status=${status}`),
  conversation: (id: string) => call<ConversationRecord>(`/api/conversations/${id}`),
  accept: (id: string) =>
    call<ConversationRecord>(`/api/conversations/${id}/accept`, { method: 'POST', body: {} }),
  deleteConversation: (id: string) =>
    call<void>(`/api/conversations/${id}`, { method: 'DELETE' }),
  read: (id: string, throughSeq: number) =>
    call<ConversationRecord>(`/api/conversations/${id}/read`, {
      method: 'POST',
      body: { through_seq: throughSeq },
    }),
  mute: (id: string, duration: MuteDuration) =>
    call<ConversationRecord>(`/api/conversations/${id}/mute`, {
      method: 'PUT',
      body: { duration },
    }),
  letters: (id: string, limit = 200) =>
    call<{ letters: LetterRecord[] }>(`/api/conversations/${id}/letters?limit=${limit}`),
  seal: (accountId: string, keyId: string, verified: boolean) =>
    call<{ account_id: string; key_id: string; seal: SealStatus }>(
      `/api/contacts/${accountId}/seal`,
      { method: 'PUT', body: { key_id: keyId, verified } },
    ),
  postLetter: (body: {
    id: string;
    conversation_id: string;
    class: 'letter' | 'control';
    recipient_key_id: string;
    iv: string;
    ciphertext: string;
    attachment_id?: string;
  }) =>
    call<LetterRecord>('/api/letters', {
      method: 'POST',
      body,
      storage: body.attachment_id !== undefined,
    }),
  letter: (id: string) => call<LetterRecord>(`/api/letters/${id}`),
  retract: (id: string) =>
    call<LetterRecord>(`/api/letters/${id}/retract`, { method: 'POST', body: {} }),
  inbox: () => call<{ letters: LetterRecord[] }>('/api/inbox'),
  ack: (throughSeq: number) =>
    call<{ delivered: number }>('/api/inbox/ack', {
      method: 'POST',
      body: { through_seq: throughSeq },
    }),
  declareBlob: (id: string, kind: 'image' | 'file' | 'photo', size: number) =>
    call<BlobRecord>('/api/blobs', { method: 'POST', body: { id, kind, size } }),
  uploadBlob: (id: string, bytes: Uint8Array) =>
    call<BlobRecord>(`/api/blobs/${id}/content`, { method: 'PUT', raw: bytes, storage: true }),
  downloadBlob: (id: string) => call<Uint8Array>(`/api/blobs/${id}`, { expectBytes: true }),
  blocks: () => call<{ blocks: BlockRecord[] }>('/api/blocks'),
  block: (accountId: string) =>
    call<BlockRecord>(`/api/blocks/${accountId}`, { method: 'PUT', body: {} }),
  unblock: (accountId: string) => call<void>(`/api/blocks/${accountId}`, { method: 'DELETE' }),
};
