import type {
  ActivityEntry,
  Attachment,
  ChangeResult,
  DecisionResult,
  IntakeRequest,
  Production,
  ServiceStatus,
  Snapshot,
  Task,
} from '../shared/types.js';
import type { ApiErrorBody } from '../shared/types.js';

/** An answer from the server that refused the request. */
export class ApiFailure extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string>;
  readonly current: Task | Task[] | null;
  readonly blockedBy: string[];
  readonly tasks: string[];

  constructor(status: number, body: ApiErrorBody | null) {
    super(body?.error.message ?? 'Promptside could not finish that.');
    this.status = status;
    this.code = body?.error.code ?? 'network_error';
    this.fields = body?.error.fields ?? {};
    this.current = body?.error.current ?? null;
    this.blockedBy = body?.error.blocked_by ?? [];
    this.tasks = body?.error.tasks ?? [];
  }
}

export const NETWORK_FAILURE = 'network_error';

let actor = 'maya';

export function setActor(handle: string): void {
  actor = handle;
}

export function currentActor(): string {
  return actor;
}

interface Options {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

async function call<T>(path: string, options: Options = {}): Promise<T> {
  const headers: Record<string, string> = { 'X-Crew-Member': actor, ...(options.headers ?? {}) };
  let body: string | undefined;
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  let response: Response;
  try {
    response = await fetch(path, { method: options.method ?? 'GET', headers, body });
  } catch {
    throw new ApiFailure(0, null);
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const parsed = text.length > 0 ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    throw new ApiFailure(response.status, parsed as ApiErrorBody | null);
  }
  return parsed as T;
}

export const api = {
  production: () => call<Production>('/api/production'),
  status: () => call<ServiceStatus>('/api/status'),
  snapshot: () => call<Snapshot>('/api/snapshot'),
  tasks: () => call<{ tasks: Task[]; snapshot: Snapshot }>('/api/tasks'),
  triageTasks: () => call<{ tasks: Task[]; snapshot: Snapshot }>('/api/tasks?status=triage'),
  activity: (id: string) => call<{ activity: ActivityEntry[] }>(`/api/tasks/${id}/activity`),
  attachments: (id: string) =>
    call<{ attachments: Attachment[] }>(`/api/tasks/${id}/attachments`),
  requests: () => call<{ requests: IntakeRequest[] }>('/api/requests'),
  patch: (id: string, version: number, body: Record<string, unknown>) =>
    call<ChangeResult>(`/api/tasks/${id}`, {
      method: 'PATCH',
      body,
      headers: { 'If-Match': String(version) },
    }),
  bulk: (tasks: { id: string; version: number }[], set: Record<string, unknown>) =>
    call<ChangeResult>('/api/tasks/bulk', { method: 'POST', body: { tasks, set } }),
  undo: () => call<ChangeResult>('/api/undo', { method: 'POST', body: {} }),
  create: (body: Record<string, unknown>) =>
    call<ChangeResult>('/api/tasks', { method: 'POST', body }),
  addLink: (id: string, blocks: string) =>
    call<ChangeResult>(`/api/tasks/${id}/relations`, { method: 'POST', body: { blocks } }),
  removeLink: (id: string, target: string) =>
    call<ChangeResult>(`/api/tasks/${id}/relations/${target}`, { method: 'DELETE' }),
  decide: (id: string, body: Record<string, unknown>) =>
    call<DecisionResult>(`/api/triage/${id}/decision`, { method: 'POST', body }),
  fileRequest: (body: Record<string, unknown>) =>
    call<{ request: IntakeRequest }>('/api/requests', { method: 'POST', body }),
  upload: uploadAttachment,
};

/** Uploads through XHR so the details pane can show real upload progress. */
function uploadAttachment(
  id: string,
  file: File,
  kind: string,
  onProgress: (percent: number) => void,
): Promise<{ attachment: Attachment }> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('kind', kind);
    form.append('file', file, file.name);
    const request = new XMLHttpRequest();
    request.open('POST', `/api/tasks/${id}/attachments`);
    request.setRequestHeader('X-Crew-Member', actor);
    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    });
    request.addEventListener('load', () => {
      const parsed = request.responseText.length > 0 ? JSON.parse(request.responseText) : null;
      if (request.status >= 200 && request.status < 300) {
        resolve(parsed as { attachment: Attachment });
      } else {
        reject(new ApiFailure(request.status, parsed as ApiErrorBody | null));
      }
    });
    request.addEventListener('error', () => reject(new ApiFailure(0, null)));
    request.addEventListener('abort', () => reject(new ApiFailure(0, null)));
    request.send(form);
  });
}
