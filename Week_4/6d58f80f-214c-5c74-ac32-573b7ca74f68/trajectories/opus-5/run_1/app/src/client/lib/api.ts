import type {
  BinItem,
  ClockBody,
  FileItem,
  Folder,
  Grant,
  Handover,
  LedgerEntry,
  MoveItem,
  MoveResult,
  PathSegment,
  Person,
  Policy,
  ServiceStatus,
  SharedItem,
  SortKey,
  StorageTotals,
  Upload,
} from '../../shared/types.js';

export class ApiFailure extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string>;
  readonly extras: Record<string, unknown>;

  constructor(status: number, code: string, body: Record<string, unknown>) {
    super(code);
    this.status = status;
    this.code = code;
    this.fields = (body.fields as Record<string, string> | undefined) ?? {};
    this.extras = body;
  }
}

const request = async <T>(
  method: string,
  path: string,
  options: { body?: unknown; headers?: Record<string, string> } = {},
): Promise<T> => {
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(path, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const json: unknown = text === '' ? null : JSON.parse(text);
  if (!response.ok) {
    throw new ApiFailure(
      response.status,
      ((json as { error?: string } | null)?.error ?? 'internal'),
      (json as Record<string, unknown> | null) ?? {},
    );
  }
  return json as T;
};

export const api = {
  signIn: (email: string, password: string) =>
    request<{ person: Person }>('POST', '/api/session', { body: { email, password } }),
  session: () => request<{ person: Person }>('GET', '/api/session'),
  signOut: () => request<void>('DELETE', '/api/session'),
  status: () => request<ServiceStatus>('GET', '/api/status'),
  clock: () => request<ClockBody>('GET', '/api/clock'),
  people: (query: string, kind: 'staff' | 'partner') =>
    request<{ people: Person[] }>(
      'GET',
      `/api/people?q=${encodeURIComponent(query)}&kind=${kind}`,
    ),
  folders: () => request<{ folders: Folder[] }>('GET', '/api/folders'),
  folder: (id: string) =>
    request<{ folder: Folder; path: PathSegment[] }>('GET', `/api/folders/${id}`),
  createFolder: (parentId: string | null, name: string) =>
    request<{ folder: Folder }>('POST', '/api/folders', { body: { parentId, name } }),
  folderActivity: (id: string) =>
    request<{ entries: LedgerEntry[] }>('GET', `/api/folders/${id}/activity`),
  files: (options: { folderId?: string | null; sort?: SortKey; q?: string }) => {
    const search = new URLSearchParams();
    if (options.folderId !== undefined && options.folderId !== null) {
      search.set('folderId', options.folderId);
    }
    if (options.sort !== undefined) search.set('sort', options.sort);
    if (options.q !== undefined && options.q !== '') search.set('q', options.q);
    const query = search.toString();
    return request<{ folders: Folder[]; files: FileItem[] }>(
      'GET',
      `/api/files${query === '' ? '' : `?${query}`}`,
    );
  },
  recent: () => request<{ files: FileItem[] }>('GET', '/api/files/recent'),
  file: (id: string) =>
    request<{ file: FileItem; path: PathSegment[] }>('GET', `/api/files/${id}`),
  rename: (id: string, name: string) =>
    request<{ file: FileItem }>('PATCH', `/api/files/${id}`, { body: { name } }),
  fileActivity: (id: string) =>
    request<{ entries: LedgerEntry[] }>('GET', `/api/files/${id}/activity`),
  link: (id: string, purpose: 'preview' | 'download') =>
    request<{ url: string; expiresAt: string }>('POST', `/api/files/${id}/links`, {
      body: { purpose },
    }),
  lock: (id: string) => request<{ file: FileItem }>('POST', `/api/files/${id}/lock`),
  unlock: (id: string) => request<{ file: FileItem }>('DELETE', `/api/files/${id}/lock`),
  move: (toFolderId: string, items: MoveItem[], key?: string) =>
    request<MoveResult>('POST', '/api/moves', {
      body: { toFolderId, items },
      headers: key === undefined ? {} : { 'Idempotency-Key': key },
    }),
  startUpload: (input: { folderId: string; name: string; size: number; contentType: string }) =>
    request<{ upload: Upload }>('POST', '/api/uploads', { body: input }),
  uploads: () => request<{ uploads: Upload[] }>('GET', '/api/uploads'),
  upload: (id: string) => request<{ upload: Upload }>('GET', `/api/uploads/${id}`),
  sendPart: async (id: string, part: number, body: Blob): Promise<Upload> => {
    const response = await fetch(`/api/uploads/${id}/parts/${part}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body,
    });
    const text = await response.text();
    const json: unknown = text === '' ? null : JSON.parse(text);
    if (!response.ok) {
      throw new ApiFailure(
        response.status,
        (json as { error?: string } | null)?.error ?? 'internal',
        (json as Record<string, unknown> | null) ?? {},
      );
    }
    return (json as { upload: Upload }).upload;
  },
  pauseUpload: (id: string) => request<{ upload: Upload }>('POST', `/api/uploads/${id}/pause`),
  resumeUpload: (id: string) => request<{ upload: Upload }>('POST', `/api/uploads/${id}/resume`),
  completeUpload: (id: string) =>
    request<{ file: FileItem }>('POST', `/api/uploads/${id}/complete`),
  cancelUpload: (id: string) => request<void>('DELETE', `/api/uploads/${id}`),
  storage: () => request<StorageTotals>('GET', '/api/storage'),
  bin: () => request<{ items: BinItem[] }>('GET', '/api/bin'),
  binFiles: (fileIds: string[]) =>
    request<{ binned: string[]; stayed: { fileId: string; reason: 'locked' }[] }>(
      'POST',
      '/api/bin',
      { body: { fileIds } },
    ),
  restore: (fileId: string) =>
    request<{ file: FileItem }>('POST', `/api/bin/${fileId}/restore`),
  deleteForever: (fileId: string) => request<void>('DELETE', `/api/bin/${fileId}`),
  grants: (itemType: 'folder' | 'file', itemId: string) =>
    request<{ grants: Grant[] }>('GET', `/api/grants?itemType=${itemType}&itemId=${itemId}`),
  grantDefaults: () =>
    request<{ today: string; defaultEndDate: string; maxEndDate: string }>(
      'GET',
      '/api/grants/defaults',
    ),
  share: (input: {
    itemType: 'folder' | 'file';
    itemId: string;
    personId: string;
    role: 'viewer' | 'editor';
    endDate?: string;
  }) => request<{ grant: Grant }>('POST', '/api/grants', { body: input }),
  changeGrant: (id: string, changes: { role?: 'viewer' | 'editor'; endDate?: string }) =>
    request<{ grant: Grant }>('PATCH', `/api/grants/${id}`, { body: changes }),
  removeGrant: (id: string) => request<void>('DELETE', `/api/grants/${id}`),
  shared: () => request<{ items: SharedItem[] }>('GET', '/api/shared'),
  policies: () => request<{ today: string; policies: Policy[] }>('GET', '/api/policies'),
  schedulePolicy: (input: {
    kind: 'bin_retention_days' | 'partner_grant_days';
    days: number;
    effectiveFrom: string;
  }) => request<{ policy: Policy }>('POST', '/api/policies', { body: input }),
  withdrawPolicy: (id: string) => request<void>('DELETE', `/api/policies/${id}`),
  handovers: () => request<{ handovers: Handover[] }>('GET', '/api/handovers'),
  offerHandover: (input: { folderId: string; toPersonId: string; days: number }) =>
    request<{ handover: Handover }>('POST', '/api/handovers', { body: input }),
  acceptHandover: (id: string) =>
    request<{ handover: Handover }>('POST', `/api/handovers/${id}/accept`),
  declineHandover: (id: string) =>
    request<{ handover: Handover }>('POST', `/api/handovers/${id}/decline`),
};
