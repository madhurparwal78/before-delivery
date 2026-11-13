export type ApiFailure = {
  status: number;
  code: string;
  message: string;
  errors?: Record<string, string>;
  field?: string;
  body: Record<string, unknown>;
  headers: Headers;
};

export class ApiCallError extends Error {
  constructor(readonly failure: ApiFailure) {
    super(failure.message);
  }
}

/** A send whose answer never arrived: the page may retry it with the same key. */
export class NoAnswerError extends Error {}

export type SendOptions = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
};

export type Answer<T> = { status: number; data: T; headers: Headers };

export async function send<T>(path: string, options: SendOptions = {}): Promise<Answer<T>> {
  const method = options.method ?? 'GET';
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: {
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(options.headers ?? {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
      credentials: 'same-origin',
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new NoAnswerError('no answer');
  }
  const text = await response.text();
  const data = text.length > 0 ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    const body = (data ?? {}) as Record<string, unknown>;
    throw new ApiCallError({
      status: response.status,
      code: typeof body.error === 'string' ? body.error : 'error',
      message: typeof body.message === 'string' ? body.message : 'Something went wrong.',
      errors: body.errors as Record<string, string> | undefined,
      field: typeof body.field === 'string' ? body.field : undefined,
      body,
      headers: response.headers,
    });
  }
  return { status: response.status, data: data as T, headers: response.headers };
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

/**
 * Idempotency keys from the page: a new key for the first send of a composed action,
 * the same key only while the outcome is unknown or after idempotency_in_progress.
 */
export class KeyedAction {
  private key: string | null = null;
  private fingerprint = '';

  keyFor(body: unknown): string {
    const fingerprint = JSON.stringify(body ?? null);
    if (this.key === null || fingerprint !== this.fingerprint) {
      this.key = newIdempotencyKey();
      this.fingerprint = fingerprint;
    }
    return this.key;
  }

  settled(): void {
    this.key = null;
    this.fingerprint = '';
  }
}

export type PartResponse = {
  slug: string;
  title: string;
  category: string;
  visibility: string;
  owner: { id: string; displayName: string };
  likes: number;
  liked: boolean;
  headRevisionId: string | null;
  revision: RevisionResponse;
  source: string;
  manifest: ManifestEntry[];
  preflightLeft: number | null;
};

export type RevisionResponse = {
  id: string;
  label: string;
  partSlug: string;
  parentRevisionId: string | null;
  authorId: string;
  createdAt: string;
  values: Record<string, number | boolean | string>;
  sourceRef: string;
  evaluationId: string | null;
  geometryDigest: string;
  message: string;
  restoredFrom: string | null;
  forkedFrom: { revisionId: string; operation: number } | null;
};

export type ManifestEntry = {
  name: string;
  label: string;
  kind: 'length' | 'angle' | 'count' | 'boolean' | 'enum';
  unit: 'mm' | '°' | null;
  value: number | boolean | string;
  default: number | boolean | string;
  min?: number;
  max?: number;
  step?: number;
  precision: number;
  options?: string[];
  group: string;
  derived: boolean;
  order: number;
};

export type SolidOp =
  | { op: 'box'; w: number; d: number; h: number }
  | { op: 'cylinder'; dia: number; h: number }
  | { op: 'boss'; dia: number; h: number; x: number; y: number }
  | { op: 'hole'; dia: number; x: number; y: number }
  | { op: 'slot'; w: number; len: number; x: number; y: number };

export type Solid = { ops: SolidOp[] };

export type EvaluationResponse = {
  id: string;
  partSlug: string;
  viewerId: string;
  seq: number;
  status: 'succeeded' | 'failed' | 'cancelled' | 'running';
  engineVersion: string;
  geometryDigest: string | null;
  volume: number;
  bbox: [number, number, number];
  faces: number;
  solid: Solid | null;
  diagnostics: { code: string; message: string; parameter: string | null }[];
  startedAt: string;
  finishedAt: string | null;
};

export type Pose = {
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
  fov: number;
};

export type Finding = {
  id: string;
  severity: 'Blocking' | 'Advisory' | 'Pass';
  code: string;
  message: string;
  cutLabel: string | null;
  measured: number;
  threshold: number;
  operation: number;
  parameters: string[];
  pose: Pose;
};

export type PreflightResponse = {
  id: string;
  partSlug: string;
  process: string;
  values: Record<string, number | boolean | string>;
  geometryDigest: string;
  status: 'complete' | 'unsupported';
  message: string | null;
  findings: Finding[];
  costBands: { quantity: number; low: number; high: number; text: string }[];
  confidence: 'High' | 'Medium' | 'Low' | null;
  createdAt: string;
};

export type TapeOperation = {
  index: number;
  kind: 'start' | 'params' | 'body' | 'cut' | 'join';
  op: string;
  line: number | null;
  digest: string;
  volume: number;
  delta: number;
  bbox: [number, number, number];
};

export type TapeResponse = {
  revisionId: string;
  n: number;
  operations: TapeOperation[];
  preflight: PreflightResponse | null;
};

export type CompareResponse = {
  base: string;
  head: string;
  identical: boolean;
  added: number;
  removed: number;
  unchanged: number;
  hunks: {
    index: number;
    kind: 'added' | 'removed';
    volume: number;
    box: { min: [number, number, number]; max: [number, number, number] };
    pose: Pose;
  }[];
  parameterChanges: {
    name: string;
    label: string;
    base: number | boolean | string;
    head: number | boolean | string;
    unit: 'mm' | '°' | null;
  }[];
};

export type RoomResponse = {
  id: string;
  partSlug: string;
  baseRevisionId: string;
  headRevisionId: string;
  title: string;
  state: 'open' | 'approved' | 'closed';
  requiredApprovals: number;
  approvals: { reviewerId: string; revisionId: string; geometryDigest: string; at: string }[];
  reviewers: { email: string; userId: string | null; displayName: string | null }[];
  createdBy: string;
};

export type CommentResponse = {
  id: string;
  roomId: string;
  author: { id: string; displayName: string };
  body: string;
  anchor: { kind: 'point'; position: [number, number, number] } | { kind: 'none' };
  pose: Pose;
  revisionId: string;
  createdAt: string;
};

export type AppConfig = {
  evalDebounceMs: number;
  slowEvalNoticeMs: number;
  commentMaxChars: number;
  requiredApprovals: number;
  preflightSignedOutLimit: number;
};

let cachedConfig: AppConfig | null = null;

export async function appConfig(): Promise<AppConfig> {
  if (!cachedConfig) cachedConfig = (await send<AppConfig>('/api/config')).data;
  return cachedConfig;
}

export type Me = { id: string; email: string; displayName: string } | null;

let cachedMe: Me | undefined;

export async function me(): Promise<Me> {
  if (cachedMe !== undefined) return cachedMe;
  try {
    cachedMe = (await send<{ id: string; email: string; displayName: string }>('/api/me')).data;
  } catch {
    cachedMe = null;
  }
  return cachedMe;
}
