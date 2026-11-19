import type {
  Person, Folder, DriveFile, PathSegment, Grant, UploadItem, BinItem,
  Handover, Policy, LedgerEntry, MoveResult, SharedItem,
} from './types.js';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public fields?: Record<string, string>,
    public extra?: Record<string, unknown>,
  ) {
    super(code);
  }
}

async function request<T>(method: string, path: string, body?: unknown, raw?: ArrayBuffer, contentType?: string, idempotencyKey?: string): Promise<T> {
  const headers: Record<string, string> = {};
  if (raw !== undefined && contentType) headers['Content-Type'] = contentType;
  else if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const res = await fetch(path, {
    method,
    headers,
    body: raw !== undefined ? raw : (body !== undefined ? JSON.stringify(body) : undefined),
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errData = data as { error?: string; fields?: Record<string, string> } & Record<string, unknown>;
    throw new ApiError(res.status, errData.error ?? 'unknown', errData.fields, errData as Record<string, unknown>);
  }
  return data as T;
}

export const api = {
  signIn: (email: string, password: string) =>
    request<{ person: Person }>('POST', '/api/session', { email, password }),
  signOut: () => request<void>('DELETE', '/api/session'),
  session: () => request<{ person: Person }>('GET', '/api/session'),
  status: () => request<{ storage: string; directory: string }>('GET', '/api/status'),
  clock: () => request<{ now: string; today: string; zone: string }>('GET', '/api/clock'),
  people: (q: string, kind?: 'staff' | 'partner') =>
    request<{ people: Person[] }>('GET', `/api/people?q=${encodeURIComponent(q)}${kind ? `&kind=${kind}` : ''}`),
  folders: () => request<{ folders: Folder[] }>('GET', '/api/folders'),
  folder: (id: string) => request<{ folder: Folder; path: PathSegment[] }>('GET', `/api/folders/${id}`),
  createFolder: (parentId: string | null, name: string) =>
    request<{ folder: Folder }>('POST', '/api/folders', { parentId, name }),
  folderActivity: (id: string) => request<{ entries: LedgerEntry[] }>('GET', `/api/folders/${id}/activity`),
  files: (params: { folderId?: string; sort?: string; q?: string }) => {
    const qs = new URLSearchParams();
    if (params.folderId) qs.set('folderId', params.folderId);
    if (params.sort) qs.set('sort', params.sort);
    if (params.q) qs.set('q', params.q);
    return request<{ folders: Folder[]; files: DriveFile[] }>('GET', `/api/files?${qs.toString()}`);
  },
  recentFiles: () => request<{ files: DriveFile[] }>('GET', '/api/files/recent'),
  file: (id: string) => request<{ file: DriveFile; path: PathSegment[] }>('GET', `/api/files/${id}`),
  fileActivity: (id: string) => request<{ entries: LedgerEntry[] }>('GET', `/api/files/${id}/activity`),
  renameFile: (id: string, name: string) => request<{ file: DriveFile }>('PATCH', `/api/files/${id}`, { name }),
  fileLink: (id: string, purpose: 'preview' | 'download') =>
    request<{ url: string; expiresAt: string }>('POST', `/api/files/${id}/links`, { purpose }),
  lockFile: (id: string) => request<{ file: DriveFile }>('POST', `/api/files/${id}/lock`),
  unlockFile: (id: string) => request<{ file: DriveFile }>('DELETE', `/api/files/${id}/lock`),
  move: (toFolderId: string, items: Array<{ fileId: string; fromFolderId: string }>, idempotencyKey?: string) =>
    request<MoveResult>('POST', '/api/moves', { toFolderId, items }, undefined, undefined, idempotencyKey),
  createUpload: (folderId: string, name: string, size: number, contentType: string, idempotencyKey?: string) =>
    request<{ upload: UploadItem }>('POST', '/api/uploads', { folderId, name, size, contentType }, undefined, undefined, idempotencyKey),
  uploads: () => request<{ uploads: UploadItem[] }>('GET', '/api/uploads'),
  uploadPart: (id: string, n: number, bytes: ArrayBuffer) =>
    request<{ upload: UploadItem }>('PUT', `/api/uploads/${id}/parts/${n}`, undefined, bytes, 'application/octet-stream'),
  pauseUpload: (id: string) => request<{ upload: UploadItem }>('POST', `/api/uploads/${id}/pause`),
  resumeUpload: (id: string) => request<{ upload: UploadItem }>('POST', `/api/uploads/${id}/resume`),
  completeUpload: (id: string) => request<{ file: DriveFile }>('POST', `/api/uploads/${id}/complete`),
  cancelUpload: (id: string) => request<void>('DELETE', `/api/uploads/${id}`),
  storage: () => request<{ usedBytes: number; binBytes: number; quotaBytes: number }>('GET', '/api/storage'),
  bin: () => request<{ items: BinItem[] }>('GET', '/api/bin'),
  binFiles: (fileIds: string[]) => request<{ binned: string[]; stayed: Array<{ fileId: string; reason: string }> }>('POST', '/api/bin', { fileIds }),
  restoreFile: (id: string) => request<{ file: DriveFile }>('POST', `/api/bin/${id}/restore`),
  deleteForever: (id: string) => request<void>('DELETE', `/api/bin/${id}`),
  grants: (itemType: string, itemId: string) =>
    request<{ grants: Grant[] }>('GET', `/api/grants?itemType=${itemType}&itemId=${itemId}`),
  createGrant: (itemType: 'folder' | 'file', itemId: string, personId: string, role: 'viewer' | 'editor', endDate?: string) =>
    request<{ grant: Grant }>('POST', '/api/grants', { itemType, itemId, personId, role, endDate }),
  updateGrant: (id: string, patch: { role?: string; endDate?: string }) =>
    request<{ grant: Grant }>('PATCH', `/api/grants/${id}`, patch),
  removeGrant: (id: string) => request<void>('DELETE', `/api/grants/${id}`),
  grantDefaults: () => request<{ today: string; defaultEndDate: string; maxEndDate: string }>('GET', '/api/grants/defaults'),
  shared: () => request<{ items: SharedItem[] }>('GET', '/api/shared'),
  policies: () => request<{ today: string; policies: Policy[] }>('GET', '/api/policies'),
  schedulePolicy: (kind: string, days: number, effectiveFrom: string) =>
    request<{ policy: Policy }>('POST', '/api/policies', { kind, days, effectiveFrom }),
  withdrawPolicy: (id: string) => request<void>('DELETE', `/api/policies/${id}`),
  handovers: () => request<{ handovers: Handover[] }>('GET', '/api/handovers'),
  offerHandover: (folderId: string, toPersonId: string, days: number) =>
    request<{ handover: Handover }>('POST', '/api/handovers', { folderId, toPersonId, days }),
  acceptHandover: (id: string) => request<{ handover: Handover }>('POST', `/api/handovers/${id}/accept`),
  declineHandover: (id: string) => request<{ handover: Handover }>('POST', `/api/handovers/${id}/decline`),
};
