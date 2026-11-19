// The browser's one fetch layer, plus the live channel subscription.

import type { AppConfig, Comment, ExportRow, Item, Me, Project, Workload } from './api-types.ts';

export type { AppConfig, Comment, ExportRow, Item, Me, Project, Workload };

export class ApiFail extends Error {
  readonly status: number;
  readonly body: Record<string, unknown>;

  constructor(status: number, body: Record<string, unknown>) {
    super(String(body.error ?? status));
    this.status = status;
    this.body = body;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, headers: {}, credentials: 'same-origin' };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'Content-Type': 'application/json' };
  }
  const res = await fetch(path, init);
  const text = await res.text();
  const parsed: unknown = text === '' ? {} : JSON.parse(text);
  if (!res.ok) {
    throw new ApiFail(res.status, (parsed ?? {}) as Record<string, unknown>);
  }
  return parsed as T;
}

export const api = {
  health: () => request<{ status: string }>('GET', '/api/health'),
  config: () => request<AppConfig>('GET', '/api/config'),
  signup: (body: { name: string; email: string; password: string }) => request<{ user: Me['user'] }>('POST', '/api/signup', body),
  signin: (body: { email: string; password: string }) => request<{ user: Me['user'] }>('POST', '/api/session', body),
  signout: () => request<void>('DELETE', '/api/session'),
  me: () => request<Me>('GET', '/api/me'),
  projects: () => request<{ projects: { id: string; name: string; workspace: { id: string; name: string }; finish: string | null }[] }>('GET', '/api/projects'),
  createProject: (body: { name: string; workspace: string }) => request<{ project: Project }>('POST', '/api/projects', body),
  project: (id: string) => request<Project>('GET', `/api/projects/${id}`),
  createItem: (projectId: string, body: { name: string; kind: string; start?: string; duration?: number; group?: string | null }) =>
    request<{ item: Item; moved: { id: string; start: string | null; end: string | null }[]; finish: string | null }>('POST', `/api/projects/${projectId}/items`, body),
  patchItem: (id: string, body: Record<string, unknown>) =>
    request<{ item: Item; moved: { id: string; start: string | null; end: string | null }[]; finish: string | null }>(`PATCH`, `/api/items/${id}`, body),
  deleteItem: (id: string) => request<{ moved: { id: string }[]; finish: string | null }>('DELETE', `/api/items/${id}`),
  reorder: (id: string, direction: 'up' | 'down') => request<{ changed: boolean; rows: { id: string; row: number; group: string | null }[] }>('POST', `/api/items/${id}/reorder`, { direction }),
  predecessors: (id: string, baseVersion: number, text: string) =>
    request<{ item: Item; moved: { id: string }[]; finish: string | null }>('PUT', `/api/items/${id}/predecessors`, { baseVersion, text }),
  createLink: (projectId: string, body: { from: string; to: string; type: string; lag: number }) =>
    request<{ link: { id: string }; moved: { id: string }[]; finish: string | null }>('POST', `/api/projects/${projectId}/links`, body),
  deleteLink: (id: string) => request<{ moved: { id: string }[]; finish: string | null }>('DELETE', `/api/links/${id}`),
  addHoliday: (projectId: string, body: { date: string; name: string }) => request<unknown>('POST', `/api/projects/${projectId}/holidays`, body),
  removeHoliday: (projectId: string, date: string) => request<unknown>('DELETE', `/api/projects/${projectId}/holidays/${date}`),
  saveBaseline: (projectId: string, body: { name: string; replace?: boolean }) => request<{ baseline: { name: string; finish: string; finishVariance: number } }>('POST', `/api/projects/${projectId}/baseline`, body),
  addAssignee: (itemId: string, body: { userId: string; hours: number }) => request<{ item: Item }>('POST', `/api/items/${itemId}/assignees`, body),
  removeAssignee: (itemId: string, userId: string) => request<{ item: Item }>('DELETE', `/api/items/${itemId}/assignees/${userId}`),
  comments: (itemId: string) => request<{ comments: Comment[] }>('GET', `/api/items/${itemId}/comments`),
  postComment: (itemId: string, text: string) => request<{ comment: Comment }>('POST', `/api/items/${itemId}/comments`, { text }),
  workload: (workspaceId: string, from: string) => request<Workload>('GET', `/api/workspaces/${workspaceId}/workload?from=${from}`),
  presence: (projectId: string, selected: string | null) => request<{ people: { userId: string; name: string; selected: string | null }[] }>('GET', `/api/projects/${projectId}/presence?selected=${selected ?? ''}`),
  createExport: (projectId: string, format: 'csv' | 'pdf') => request<ExportRow>('POST', `/api/projects/${projectId}/exports`, { format }),
  exports: (projectId: string) => request<{ exports: ExportRow[] }>('GET', `/api/projects/${projectId}/exports`),
};

export interface LiveEvent {
  kind: string;
  payload: Record<string, unknown>;
}

export function openLive(projectId: string, onEvent: (event: LiveEvent) => void): EventSource {
  const source = new EventSource(`/api/projects/${projectId}/live`);
  source.onmessage = (message) => {
    try {
      onEvent(JSON.parse(message.data) as LiveEvent);
    } catch {
      // Ignore malformed frames.
    }
  };
  return source;
}
