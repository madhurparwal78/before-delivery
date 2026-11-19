export interface ApiFailure {
  status: number;
  error?: string;
  errors?: Record<string, string>;
  latest?: number;
  holder?: string;
}

export class ApiCallError extends Error {
  constructor(readonly failure: ApiFailure) {
    super(`api_${failure.status}`);
  }
}

async function send<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin' };
  if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(path, init);
  if (res.status === 204) return undefined as T;
  const payload = res.headers.get('content-type')?.includes('application/json')
    ? await res.json()
    : null;
  if (!res.ok) throw new ApiCallError({ status: res.status, ...(payload ?? {}) });
  return payload as T;
}

export const api = {
  get: <T>(path: string) => send<T>('GET', path),
  post: <T>(path: string, body?: unknown) => send<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body: unknown) => send<T>('PATCH', path, body),
  put: <T>(path: string, body: unknown) => send<T>('PUT', path, body),
  del: <T>(path: string, body?: unknown) => send<T>('DELETE', path, body),
};

export async function upload(
  path: string,
  file: File,
): Promise<{ id: string; name: string; size: number }> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(path, { method: 'POST', body: form, credentials: 'same-origin' });
  const payload = res.headers.get('content-type')?.includes('application/json')
    ? await res.json()
    : null;
  if (!res.ok) throw new ApiCallError({ status: res.status, ...(payload ?? {}) });
  return payload;
}

export interface Task {
  id: string;
  projectId: string;
  name: string;
  description: string;
  section: string;
  position: number;
  parentId: string | null;
  assigneeId: string | null;
  start: string | null;
  due: string | null;
  effort: number | null;
  completed: boolean;
  version: number;
  recurrence: string | null;
  dueStatus: 'overdue' | 'today' | 'later' | 'none';
  values: Record<string, unknown>;
  successorDue?: string | null;
}

export interface Field {
  id: string;
  name: string;
  type: string;
  options: string[];
  formula: string | null;
}

export interface Section {
  id: string;
  name: string;
  position: number;
}

export interface Member {
  id: string;
  name: string;
  email: string;
}

export interface Project {
  id: string;
  name: string;
  teamId: string;
  progress: number;
  members: Member[];
  sections: Section[];
  fields: Field[];
  dependencies: { from: string; to: string }[];
}

export interface Me {
  id: string | null;
  name: string | null;
  email: string | null;
  verified: boolean;
  teams: { id: string; name: string; role: string }[];
}

export interface RuleRun {
  id: string;
  depth: number;
  summary: string;
  detail: string;
  createdAt: string;
}

export interface InboxItem {
  id: string;
  text: string;
  taskId: string | null;
  kind: string;
  read: boolean;
  createdAt: string;
}

export interface Goal {
  id: string;
  name: string;
  parentId: string | null;
  weight: number;
  manualValue: number;
  ownerId: string | null;
  progress: number;
  percent: number;
  projects: { projectId: string; name: string; weight: number; progress: number }[];
}

export interface WorkloadCell {
  date: string;
  total: number;
  capacity: number;
  over: boolean;
  text: string;
  tasks: { id: string; name: string }[];
}

export interface Workload {
  from: string;
  days: string[];
  people: { id: string; name: string; cells: WorkloadCell[] }[];
}

export interface TaskDetail extends Task {
  attachments: { id: string; name: string; size: number }[];
  approval: { status: string; approverId: string | null; requesterId: string | null };
  blocks: string[];
  blockedBy: string[];
  history: { text: string; createdAt: string }[];
  viewing: { id: string; name: string }[];
  holds: { field: string; personId: string; name: string }[];
}

export interface Rule {
  id: string;
  name: string;
  position: number;
  trigger: Record<string, unknown>;
  condition: Record<string, unknown> | null;
  action: Record<string, unknown>;
}
