import type {
  DailyPullJson,
  LibraryJson,
  ReelJson,
  ReelListJson,
  ReferenceJson,
  SearchJson,
  SettingsJson,
  SheetJson,
  SheetListJson,
  StatusJson,
  TrashJson,
  Unit,
} from '../shared/types.js';

export class ApiCallError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string>;

  constructor(status: number, code: string, message: string, fields: Record<string, string>) {
    super(message);
    this.name = 'ApiCallError';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

async function readError(response: Response): Promise<ApiCallError> {
  const body = (await response.json().catch(() => null)) as {
    error?: { code?: string; message?: string; fields?: Record<string, string> };
  } | null;
  return new ApiCallError(
    response.status,
    body?.error?.code ?? 'unknown',
    body?.error?.message ?? '',
    body?.error?.fields ?? {},
  );
}

async function call<T>(
  method: string,
  path: string,
  options: { body?: BodyInit; headers?: Record<string, string>; signal?: AbortSignal } = {},
): Promise<T> {
  const response = await fetch(path, {
    method,
    body: options.body,
    headers: options.headers,
    signal: options.signal,
    credentials: 'same-origin',
  });
  if (!response.ok) throw await readError(response);
  return (await response.json()) as T;
}

function json(body: unknown): { body: BodyInit; headers: Record<string, string> } {
  return { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } };
}

export const api = {
  status: () => call<StatusJson>('GET', '/api/status'),
  library: () => call<LibraryJson>('GET', '/api/references'),
  search: (query: string, colourFamily: string, signal: AbortSignal) => {
    const parameters = new URLSearchParams({ q: query });
    if (colourFamily) parameters.set('colour_family', colourFamily);
    return call<SearchJson>('GET', `/api/search?${parameters.toString()}`, { signal });
  },
  reference: (id: string) => call<ReferenceJson>('GET', `/api/references/${id}`),
  capture: (form: FormData, idempotencyKey: string) =>
    call<ReferenceJson>('POST', '/api/references', {
      body: form,
      headers: { 'Idempotency-Key': idempotencyKey },
    }),
  patchFacts: (id: string, body: Record<string, unknown>) =>
    call<ReferenceJson>('PATCH', `/api/references/${id}`, json(body)),
  setSwatch: (id: string, x: number, y: number) =>
    call<ReferenceJson>('POST', `/api/references/${id}/swatch`, json({ x, y })),
  resetSwatch: (id: string) => call<ReferenceJson>('DELETE', `/api/references/${id}/swatch`),
  trash: (id: string) => call<ReferenceJson>('DELETE', `/api/references/${id}`),
  restore: (id: string) => call<ReferenceJson>('POST', `/api/references/${id}/restore`),
  trashList: () => call<TrashJson>('GET', '/api/trash'),
  reels: () => call<ReelListJson>('GET', '/api/reels'),
  createReel: (name: string) => call<ReelJson>('POST', '/api/reels', json({ name })),
  reel: (id: string) => call<ReelJson>('GET', `/api/reels/${id}`),
  appendStop: (reelId: string, referenceId: string) =>
    call<ReelJson>('POST', `/api/reels/${reelId}/stops`, json({ reference_id: referenceId })),
  reorderStops: (reelId: string, version: number, referenceIds: string[]) =>
    call<ReelJson>(
      'PUT',
      `/api/reels/${reelId}/stops`,
      json({ version, reference_ids: referenceIds }),
    ),
  requestSheet: (reelId: string, paper: string, unit: Unit, idempotencyKey: string) =>
    call<SheetJson>('POST', `/api/reels/${reelId}/sheets`, {
      ...json({ paper, unit }),
      headers: { 'content-type': 'application/json', 'Idempotency-Key': idempotencyKey },
    }),
  sheets: (reelId: string) => call<SheetListJson>('GET', `/api/reels/${reelId}/sheets`),
  retrySheet: (id: string) => call<SheetJson>('POST', `/api/sheets/${id}/retry`),
  dailyPull: () => call<DailyPullJson>('GET', '/api/daily-pull'),
  settings: () => call<SettingsJson>('GET', '/api/settings'),
  saveHomeZone: (zone: string) =>
    call<SettingsJson>('PUT', '/api/settings/home-zone', json({ zone })),
  saveUnit: (unit: Unit) => call<SettingsJson>('PUT', '/api/settings/unit', json({ unit })),
};

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
