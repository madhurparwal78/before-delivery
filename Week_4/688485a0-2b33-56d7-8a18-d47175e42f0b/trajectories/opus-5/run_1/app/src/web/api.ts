export interface ErrorBody {
  error: string;
  [key: string]: unknown;
}

export class ApiFailure extends Error {
  readonly status: number;
  readonly body: ErrorBody;

  constructor(status: number, body: ErrorBody) {
    super(body.error);
    this.status = status;
    this.body = body;
  }

  get code(): string {
    return this.body.error;
  }
}

async function parse<T>(answer: Response): Promise<T> {
  if (answer.status === 204) return undefined as T;
  const text = await answer.text();
  const value = text.length > 0 ? (JSON.parse(text) as unknown) : {};
  if (!answer.ok) throw new ApiFailure(answer.status, value as ErrorBody);
  return value as T;
}

export async function apiGet<T>(path: string): Promise<T> {
  return parse<T>(await fetch(path, { credentials: 'same-origin' }));
}

export async function apiSend<T>(
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  payload?: unknown,
): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin' };
  if (payload !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(payload);
  }
  return parse<T>(await fetch(path, init));
}

export async function apiUpload<T>(path: string, fileName: string, bytes: ArrayBuffer): Promise<T> {
  return parse<T>(
    await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-File-Name': fileName, 'Content-Type': 'application/octet-stream' },
      body: bytes,
    }),
  );
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

export type Role = 'owner' | 'editor' | 'reader';

export interface CollectionSummary {
  id: string;
  name: string;
  count: number;
}

export interface QueryPlan {
  kind: 'index' | 'full_scan';
  index: string | null;
  docs_examined: number;
  returned: number;
}

export interface QueryAnswer {
  matched: number;
  page: number;
  page_size: number;
  documents: unknown[];
  ids: string[];
  plan: QueryPlan;
}

export interface StageAnswer {
  index: number;
  count: number;
  disabled: boolean;
  documents: unknown[];
}

export interface PreviewAnswer {
  input: number;
  stages: StageAnswer[];
  pin: { _id: string; stopped_at: number | null } | null;
  pipeline?: string[];
}

export interface IndexAnswer {
  name: string;
  keys: Record<string, number>;
  unique: boolean;
}

export interface SchemaAnswer {
  sampled: number;
  fields: Array<{ path: string; present: number; types: Array<{ type: string; share: number }> }>;
}

export interface SavedQueryAnswer {
  id: string;
  name: string;
  filter: unknown;
  projection: unknown;
  sort: unknown;
  limit: number;
  last_run_at: string | null;
  last_count: number | null;
}

export interface MemberAnswer {
  user_id: string;
  email: string;
  name: string;
  role: Role;
}

export interface InvitationAnswer {
  id: string;
  email: string;
  role: 'editor' | 'reader';
  state: string;
}

export interface PendingInvitation {
  id: string;
  project: { id: string; name: string };
  role: 'editor' | 'reader';
  inviter: { name: string };
}

export interface ImportAnswer {
  id: string;
  file_name: string;
  format: string;
  state: string;
  bytes: number;
  inserted: number;
  errors: Array<{ line: number; message: string }>;
  created_at: string;
}

export const collectionPath = (pid: string, cid: string): string => `/api/projects/${pid}/collections/${cid}`;
