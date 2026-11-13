import type {
  ApiErrorBody,
  CatalogueWork,
  Cut,
  Folder,
  FolderListEntry,
  FolderPage,
  Notice,
  Part,
  ProgrammeDetail,
  ProgrammeStatus,
  ProgrammeSummary,
  RentalSet,
  Scan,
  ScanKind,
  ServiceStatus,
  StringCount,
  User,
  WorkDetail,
  WorkSummary,
} from '../../shared/api.js';

export class ApiFailure extends Error {
  readonly status: number;
  readonly body: ApiErrorBody;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.status = status;
    this.body = body;
  }

  fieldError(field: string): string | undefined {
    return this.body.errors?.[field];
  }
}

export class NetworkFailure extends Error {}

async function request<Result>(
  method: string,
  path: string,
  options: { body?: unknown; idempotencyKey?: string } = {},
): Promise<Result> {
  const headers: Record<string, string> = {};
  let body: string | undefined;
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  if (options.idempotencyKey !== undefined) headers['Idempotency-Key'] = options.idempotencyKey;

  let response: Response;
  try {
    response = await fetch(path, { method, headers, body, credentials: 'same-origin' });
  } catch {
    throw new NetworkFailure('the request did not finish');
  }
  if (response.status === 204) return undefined as Result;
  const text = await response.text();
  const parsed: unknown = text === '' ? {} : JSON.parse(text);
  if (!response.ok) {
    throw new ApiFailure(response.status, parsed as ApiErrorBody);
  }
  return parsed as Result;
}

export interface UploadOutcome {
  scan: Scan;
}

export function uploadScan(
  partId: string,
  kind: ScanKind,
  file: File,
  handlers: { onProgress?: (fraction: number) => void; idempotencyKey?: string } = {},
): Promise<UploadOutcome> {
  return new Promise<UploadOutcome>((resolve, reject) => {
    const form = new FormData();
    form.append('kind', kind);
    form.append('file', file, file.name);
    const request_ = new XMLHttpRequest();
    request_.open('POST', `/api/parts/${encodeURIComponent(partId)}/scans`);
    if (handlers.idempotencyKey !== undefined) {
      request_.setRequestHeader('Idempotency-Key', handlers.idempotencyKey);
    }
    request_.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && handlers.onProgress) handlers.onProgress(event.loaded / event.total);
    });
    request_.addEventListener('load', () => {
      let parsed: unknown = {};
      try {
        parsed = request_.responseText === '' ? {} : JSON.parse(request_.responseText);
      } catch {
        reject(new NetworkFailure('the upload did not finish'));
        return;
      }
      if (request_.status >= 200 && request_.status < 300) {
        resolve(parsed as UploadOutcome);
        return;
      }
      reject(new ApiFailure(request_.status, parsed as ApiErrorBody));
    });
    request_.addEventListener('error', () => reject(new NetworkFailure('the upload did not finish')));
    request_.addEventListener('abort', () => reject(new NetworkFailure('the upload did not finish')));
    request_.send(form);
  });
}

export const api = {
  signIn: (email: string, passcode: string) =>
    request<{ user: User }>('POST', '/api/session', { body: { email, passcode } }),
  session: () => request<{ user: User }>('GET', '/api/session'),
  signOut: () => request<void>('DELETE', '/api/session'),
  serviceStatus: () => request<ServiceStatus>('GET', '/api/status'),
  catalogue: () => request<{ works: CatalogueWork[] }>('GET', '/api/catalogue'),
  programmes: () => request<{ programmes: ProgrammeSummary[] }>('GET', '/api/programmes'),
  programme: (id: string) => request<ProgrammeDetail>('GET', `/api/programmes/${encodeURIComponent(id)}`),
  createProgramme: (body: {
    title: string;
    first_rehearsal: string;
    performances: string[];
    string_count: StringCount;
  }) => request<ProgrammeDetail>('POST', '/api/programmes', { body }),
  saveStringCount: (id: string, count: StringCount) =>
    request<ProgrammeDetail>('PUT', `/api/programmes/${encodeURIComponent(id)}/string-count`, { body: count }),
  addWork: (id: string, catalogueWorkId: string) =>
    request<WorkDetail>('POST', `/api/programmes/${encodeURIComponent(id)}/works`, {
      body: { catalogue_work_id: catalogueWorkId },
    }),
  transitionProgramme: (id: string, to: ProgrammeStatus) =>
    request<ProgrammeDetail>('POST', `/api/programmes/${encodeURIComponent(id)}/transition`, { body: { to } }),
  publish: (id: string, idempotencyKey: string) =>
    request<{ programme: ProgrammeDetail; notices: { sent: number; queued: number } }>(
      'POST',
      `/api/programmes/${encodeURIComponent(id)}/publish`,
      { idempotencyKey },
    ),
  notices: (id: string) =>
    request<{ notices: Notice[] }>('GET', `/api/programmes/${encodeURIComponent(id)}/notices`),
  work: (id: string) => request<WorkDetail>('GET', `/api/works/${encodeURIComponent(id)}`),
  createCut: (workId: string, fromBar: number, toBar: number) =>
    request<{ cut: Cut; work: WorkDetail; programme: ProgrammeSummary }>(
      'POST',
      `/api/works/${encodeURIComponent(workId)}/cuts`,
      { body: { from_bar: fromBar, to_bar: toBar } },
    ),
  deleteCut: (cutId: string) =>
    request<{ work: WorkDetail; programme: ProgrammeSummary }>('DELETE', `/api/cuts/${encodeURIComponent(cutId)}`),
  saveHoldings: (partId: string, copiesOnHand: number) =>
    request<{ part: Part; work: WorkSummary; programme: ProgrammeSummary }>(
      'PUT',
      `/api/parts/${encodeURIComponent(partId)}/holdings`,
      { body: { copies_on_hand: copiesOnHand } },
    ),
  recordMark: (partId: string, cutId: string) =>
    request<{ part: Part }>('POST', `/api/parts/${encodeURIComponent(partId)}/marks`, { body: { cut_id: cutId } }),
  scans: (partId: string) => request<{ scans: Scan[] }>('GET', `/api/parts/${encodeURIComponent(partId)}/scans`),
  folders: () => request<{ folders: FolderListEntry[] }>('GET', '/api/folders'),
  folder: (programmeId: string) => request<Folder>('GET', `/api/folders/${encodeURIComponent(programmeId)}`),
  folderPage: (programmeId: string, partId: string) =>
    request<FolderPage>(
      'GET',
      `/api/folders/${encodeURIComponent(programmeId)}/parts/${encodeURIComponent(partId)}`,
    ),
  rentalSets: () => request<{ rental_sets: RentalSet[] }>('GET', '/api/rental-sets'),
  createRentalSet: (body: { work_id: string; publisher: string; slip: { part_id: string; copies: number }[] }) =>
    request<RentalSet>('POST', '/api/rental-sets', { body }),
  transitionRentalSet: (id: string, to: RentalSet['status']) =>
    request<RentalSet>('POST', `/api/rental-sets/${encodeURIComponent(id)}/transition`, { body: { to } }),
  checkIn: (id: string, counts: { part_id: string; copies: number; expected: number }[]) =>
    request<RentalSet>('PUT', `/api/rental-sets/${encodeURIComponent(id)}/check-in`, { body: { counts } }),
  uploadScan,
};

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
