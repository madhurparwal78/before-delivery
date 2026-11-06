import { config } from '../env.js';
import { SEED_REQUESTS } from '../db/seed-data.js';

export interface IntakeRecord {
  id: string;
  title: string;
  details: string;
  requester: string;
  department: string;
  status: 'pending' | 'accepted' | 'declined' | 'merged';
  task: string;
  decision_note: string;
  decided_at: string;
  created: string;
}

/** The intake could not be reached, so nothing was written. */
export class IntakeUnavailable extends Error {}
/** The intake answered with a refusal. */
export class IntakeRejected extends Error {}

const COLLECTION = 'requests';
const TIMEOUT_MS = 4000;

const COLLECTION_SCHEMA = [
  { name: 'title', type: 'text', required: true },
  { name: 'details', type: 'text', required: false },
  { name: 'requester', type: 'text', required: true },
  { name: 'department', type: 'text', required: false },
  {
    name: 'status',
    type: 'select',
    required: true,
    options: { maxSelect: 1, values: ['pending', 'accepted', 'declined', 'merged'] },
  },
  { name: 'task', type: 'text', required: false },
  { name: 'decision_note', type: 'text', required: false },
  { name: 'decided_at', type: 'date', required: false },
];

let token: string | null = null;

async function call(
  path: string,
  init: { method?: string; body?: unknown; auth?: boolean } = {},
): Promise<unknown> {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (init.auth !== false) headers.Authorization = await adminToken();
  let response: Response;
  try {
    response = await fetch(`${config.intake.url}${path}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    token = null;
    throw new IntakeUnavailable(`Request intake did not answer ${path}`);
  }
  if (response.status === 401 || response.status === 403) {
    token = null;
    throw new IntakeRejected(`Request intake refused ${path}`);
  }
  if (response.status >= 500) {
    throw new IntakeUnavailable(`Request intake failed on ${path}`);
  }
  if (!response.ok) {
    throw new IntakeRejected(`Request intake refused ${path} with ${response.status}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

async function adminToken(): Promise<string> {
  if (token !== null) return token;
  let response: Response;
  try {
    response = await fetch(`${config.intake.url}/api/admins/auth-with-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identity: config.intake.adminEmail,
        password: config.intake.adminPassword,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new IntakeUnavailable('Request intake did not answer the sign-in');
  }
  if (!response.ok) {
    if (response.status >= 500) throw new IntakeUnavailable('Request intake failed the sign-in');
    throw new IntakeRejected('Request intake refused the sign-in');
  }
  const body = (await response.json()) as { token?: string };
  if (typeof body.token !== 'string') throw new IntakeRejected('Request intake sent no token');
  token = body.token;
  return token;
}

/** Makes sure the requests collection exists, and seeds it when it is new. */
export async function ensureCollection(): Promise<void> {
  const existing = (await call(`/api/collections?perPage=200`)) as {
    items?: { name: string }[];
  };
  if ((existing.items ?? []).some((item) => item.name === COLLECTION)) return;
  await call('/api/collections', {
    method: 'POST',
    body: {
      name: COLLECTION,
      type: 'base',
      schema: COLLECTION_SCHEMA,
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
    },
  });
  for (const seed of SEED_REQUESTS) {
    await createRequest(seed.title, seed.details, seed.requester, seed.department);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function toRecord(raw: unknown): IntakeRecord {
  const row = raw as Record<string, unknown>;
  return {
    id: String(row.id ?? ''),
    title: String(row.title ?? ''),
    details: String(row.details ?? ''),
    requester: String(row.requester ?? ''),
    department: String(row.department ?? ''),
    status: (row.status as IntakeRecord['status']) ?? 'pending',
    task: String(row.task ?? ''),
    decision_note: String(row.decision_note ?? ''),
    decided_at: String(row.decided_at ?? ''),
    created: String(row.created ?? ''),
  };
}

export async function listRequests(): Promise<IntakeRecord[]> {
  const body = (await call(
    `/api/collections/${COLLECTION}/records?perPage=500&sort=-created`,
  )) as { items?: unknown[] };
  return (body.items ?? []).map(toRecord);
}

/** Every pending record, in the order the rehearsal room filed them. */
export async function listPending(): Promise<IntakeRecord[]> {
  const filter = encodeURIComponent("status='pending' && task=''");
  const body = (await call(
    `/api/collections/${COLLECTION}/records?perPage=500&sort=created&filter=${filter}`,
  )) as { items?: unknown[] };
  return (body.items ?? []).map(toRecord);
}

export async function getRequest(id: string): Promise<IntakeRecord> {
  const body = await call(`/api/collections/${COLLECTION}/records/${encodeURIComponent(id)}`);
  return toRecord(body);
}

export async function createRequest(
  title: string,
  details: string,
  requester: string,
  department: string,
): Promise<IntakeRecord> {
  const body = await call(`/api/collections/${COLLECTION}/records`, {
    method: 'POST',
    body: { title, details, requester, department, status: 'pending', task: '' },
  });
  return toRecord(body);
}

export async function writeDecision(
  id: string,
  outcome: { status: 'accepted' | 'declined' | 'merged'; task: string; note: string; at: Date },
): Promise<IntakeRecord> {
  const body = await call(`/api/collections/${COLLECTION}/records/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: {
      status: outcome.status,
      task: outcome.task,
      decision_note: outcome.note,
      decided_at: outcome.at.toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z'),
    },
  });
  return toRecord(body);
}

export async function checkIntake(): Promise<boolean> {
  try {
    const response = await fetch(`${config.intake.url}/api/health`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}
