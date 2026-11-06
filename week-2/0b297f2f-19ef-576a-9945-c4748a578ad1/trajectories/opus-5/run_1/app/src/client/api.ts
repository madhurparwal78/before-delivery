import type {
  ApiErrorBody,
  ConditionPhoto,
  ExhibitionResponse,
  HangEvent,
  LoanObject,
  Placement,
  Preview,
  Staff,
  StatusResponse,
  UndoWindow,
  Wall,
} from '../shared/types';

export class ApiCallError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody;

  constructor(status: number, body: ApiErrorBody) {
    super(body.error.message);
    this.name = 'ApiCallError';
    this.status = status;
    this.body = body;
  }

  get code(): string {
    return this.body.error.code;
  }

  get fields(): Record<string, string> {
    return this.body.error.fields ?? {};
  }
}

let staffId = '';

export function setApiStaffId(id: string): void {
  staffId = id;
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  extraHeaders: Record<string, string> = {},
): Promise<T> {
  const headers: Record<string, string> = { ...extraHeaders };
  if (staffId !== '') headers['X-Staff-Id'] = staffId;
  const response = await fetch(path, { ...init, headers });
  const contentType = response.headers.get('content-type') ?? '';
  if (!response.ok) {
    if (contentType.includes('application/json')) {
      throw new ApiCallError(response.status, (await response.json()) as ApiErrorBody);
    }
    throw new ApiCallError(response.status, {
      error: { code: 'request_failed', message: 'The request failed.' },
    });
  }
  return (await response.json()) as T;
}

function jsonInit(method: string, body: unknown): RequestInit {
  return { method, body: JSON.stringify(body) };
}

const jsonHeaders = { 'Content-Type': 'application/json' };

export interface PlacementsResponse {
  placements: Placement[];
  overBudgetCount: number;
}

export const api = {
  status: (): Promise<StatusResponse> => request('/api/status'),
  staff: (): Promise<{ staff: Staff[] }> => request('/api/staff'),
  exhibition: (): Promise<ExhibitionResponse> => request('/api/exhibition'),
  placements: (): Promise<PlacementsResponse> => request('/api/placements'),
  objects: (search = ''): Promise<{ objects: LoanObject[] }> =>
    request(`/api/objects${search}`),
  object: (id: string): Promise<{ object: LoanObject }> => request(`/api/objects/${id}`),
  events: (after: number): Promise<{ events: HangEvent[]; latestSeq: number }> =>
    request(`/api/events?after=${after}`),
  eventsHead: (): Promise<{ events: HangEvent[]; latestSeq: number }> => request('/api/events'),
  preview: (): Promise<{ preview: Preview }> => request('/api/preview'),
  place: (body: {
    objectId: string;
    wallId: string;
    offsetMm: number;
    centreHeightMm: number;
    heightOverride: boolean;
  }): Promise<{ placement: Placement; seq: number }> =>
    request('/api/placements', jsonInit('POST', body), jsonHeaders),
  move: (
    id: string,
    body: {
      version: number;
      offsetMm?: number;
      centreHeightMm?: number;
      heightOverride?: boolean;
      wallId?: string;
    },
  ): Promise<{ placement: Placement; undo: UndoWindow; seq: number }> =>
    request(`/api/placements/${id}`, jsonInit('PATCH', body), jsonHeaders),
  remove: (id: string): Promise<{ placement: Placement; undo: UndoWindow; seq: number }> =>
    request(`/api/placements/${id}`, { method: 'DELETE' }),
  undo: (actionId: string): Promise<{ placement: Placement; seq: number }> =>
    request(`/api/undo/${actionId}`, { method: 'POST' }),
  claim: (id: string): Promise<{ placement: Placement; seq?: number }> =>
    request(`/api/placements/${id}/claim`, { method: 'POST' }),
  release: (id: string): Promise<{ placement: Placement; seq: number }> =>
    request(`/api/placements/${id}/release`, { method: 'POST' }),
  hang: (id: string): Promise<{ placement: Placement; seq: number }> =>
    request(`/api/placements/${id}/hang`, { method: 'POST' }),
  signOff: (id: string): Promise<{ placement: Placement; seq: number }> =>
    request(`/api/placements/${id}/sign-off`, { method: 'POST' }),
  setWallLux: (
    id: string,
    plannedLux: number,
  ): Promise<{ wall: Wall; placements: Placement[]; seq: number }> =>
    request(`/api/walls/${id}`, jsonInit('PATCH', { plannedLux }), jsonHeaders),
  createObject: (body: Record<string, unknown>): Promise<{ object: LoanObject; seq: number }> =>
    request('/api/objects', jsonInit('POST', body), jsonHeaders),
  updateObject: (
    id: string,
    body: Record<string, unknown>,
  ): Promise<{ object: LoanObject; placements: Placement[]; seq: number }> =>
    request(`/api/objects/${id}`, jsonInit('PATCH', body), jsonHeaders),
  uploadPhoto: (
    objectId: string,
    file: File,
  ): Promise<{ photo: ConditionPhoto; seq: number }> =>
    request(
      `/api/objects/${objectId}/photos`,
      { method: 'POST', body: file },
      { 'Content-Type': file.type },
    ),
  schedulePreview: (date: string): Promise<{ preview: Preview; seq: number }> =>
    request('/api/preview/schedule', jsonInit('POST', { date }), jsonHeaders),
  cancelPreview: (): Promise<{ preview: Preview; seq: number }> =>
    request('/api/preview/cancel', { method: 'POST' }),
  withdrawPreview: (): Promise<{ preview: Preview; seq: number }> =>
    request('/api/preview/withdraw', { method: 'POST' }),
};
