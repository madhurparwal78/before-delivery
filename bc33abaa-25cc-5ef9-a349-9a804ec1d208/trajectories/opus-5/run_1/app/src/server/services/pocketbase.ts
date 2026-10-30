import { config } from '../config';

type FieldType = 'text' | 'bool' | 'json';

interface CollectionField {
  name: string;
  type: FieldType;
}

const COLLECTIONS: { name: string; fields: CollectionField[] }[] = [
  {
    name: 'presence',
    fields: [
      { name: 'workspace', type: 'text' },
      { name: 'scene', type: 'text' },
      { name: 'authorKind', type: 'text' },
      { name: 'authorId', type: 'text' },
      { name: 'authorName', type: 'text' },
      { name: 'selection', type: 'text' },
      { name: 'cursor', type: 'json' },
      { name: 'seenAt', type: 'text' },
    ],
  },
  {
    name: 'object_locks',
    fields: [
      { name: 'workspace', type: 'text' },
      { name: 'scene', type: 'text' },
      { name: 'node', type: 'text' },
      { name: 'holderKind', type: 'text' },
      { name: 'holderId', type: 'text' },
      { name: 'holderName', type: 'text' },
      { name: 'expiresAt', type: 'text' },
    ],
  },
  {
    name: 'comments',
    fields: [
      { name: 'workspace', type: 'text' },
      { name: 'scene', type: 'text' },
      { name: 'commentId', type: 'text' },
      { name: 'node', type: 'text' },
      { name: 'body', type: 'text' },
      { name: 'authorId', type: 'text' },
      { name: 'authorName', type: 'text' },
      { name: 'mentions', type: 'json' },
      { name: 'resolved', type: 'bool' },
    ],
  },
];

function fieldOptions(type: FieldType): Record<string, unknown> {
  if (type === 'json') return { maxSize: 200_000 };
  if (type === 'text') return { min: null, max: null, pattern: '' };
  return {};
}

let token: string | null = null;
let collectionsReady = false;

async function adminToken(): Promise<string> {
  if (token) return token;
  const response = await fetch(`${config.pocketbase.url}/api/admins/auth-with-password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      identity: config.pocketbase.adminEmail,
      password: config.pocketbase.adminPassword,
    }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`PocketBase auth answered ${response.status}`);
  const body = (await response.json()) as { token?: string };
  if (!body.token) throw new Error('PocketBase auth returned no token');
  token = body.token;
  return token;
}

async function call(path: string, init: { method?: string; body?: unknown } = {}): Promise<unknown> {
  const authToken = await adminToken();
  const response = await fetch(`${config.pocketbase.url}${path}`, {
    method: init.method ?? 'GET',
    headers: { 'content-type': 'application/json', Authorization: authToken },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(5_000),
  });
  if (response.status === 401 || response.status === 403) token = null;
  if (!response.ok) throw new Error(`PocketBase ${path} answered ${response.status}`);
  if (response.status === 204) return null;
  return (await response.json()) as unknown;
}

export async function ensureCollections(): Promise<void> {
  if (collectionsReady) return;
  const existing = (await call('/api/collections?perPage=200')) as { items?: { name: string }[] };
  const names = new Set((existing.items ?? []).map((item) => item.name));
  for (const collection of COLLECTIONS) {
    if (names.has(collection.name)) continue;
    await call('/api/collections', {
      method: 'POST',
      body: {
        name: collection.name,
        type: 'base',
        schema: collection.fields.map((field) => ({
          name: field.name,
          type: field.type,
          required: false,
          options: fieldOptions(field.type),
        })),
      },
    });
  }
  collectionsReady = true;
}

async function findRecord(collection: string, filter: string): Promise<string | null> {
  const result = (await call(
    `/api/collections/${collection}/records?perPage=1&filter=${encodeURIComponent(filter)}`,
  )) as { items?: { id: string }[] };
  return result.items?.[0]?.id ?? null;
}

async function upsert(collection: string, filter: string, data: Record<string, unknown>): Promise<void> {
  await ensureCollections();
  const id = await findRecord(collection, filter);
  if (id) await call(`/api/collections/${collection}/records/${id}`, { method: 'PATCH', body: data });
  else await call(`/api/collections/${collection}/records`, { method: 'POST', body: data });
}

async function remove(collection: string, filter: string): Promise<void> {
  await ensureCollections();
  const id = await findRecord(collection, filter);
  if (id) await call(`/api/collections/${collection}/records/${id}`, { method: 'DELETE' });
}

function quote(value: string): string {
  return `"${value.replace(/"/g, '')}"`;
}

/** The collaboration mirror never blocks a request: PostgreSQL stays the source of truth. */
interface QueuedMirror {
  run: () => Promise<unknown>;
  attempts: number;
}

const queue: QueuedMirror[] = [];
let draining = false;

async function drain(): Promise<void> {
  while (queue.length > 0) {
    const entry = queue.shift();
    if (!entry) continue;
    try {
      await entry.run();
    } catch {
      collectionsReady = false;
      if (entry.attempts < 3) {
        queue.push({ run: entry.run, attempts: entry.attempts + 1 });
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
    }
  }
  draining = false;
}

function enqueue(work: () => Promise<unknown>): void {
  queue.push({ run: work, attempts: 0 });
  if (draining) return;
  draining = true;
  void drain();
}

export const mirror = {
  presence(record: {
    workspaceId: string;
    sceneId: string;
    authorKind: string;
    authorId: string;
    authorName: string;
    selection: string | null;
    cursor: number[] | null;
    seenAt: string;
  }): void {
    enqueue(() =>
      upsert('presence', `scene=${quote(record.sceneId)} && authorId=${quote(record.authorId)}`, {
        workspace: record.workspaceId,
        scene: record.sceneId,
        authorKind: record.authorKind,
        authorId: record.authorId,
        authorName: record.authorName,
        selection: record.selection ?? '',
        cursor: record.cursor ?? [],
        seenAt: record.seenAt,
      }),
    );
  },
  presenceGone(sceneId: string, authorId: string): void {
    enqueue(() => remove('presence', `scene=${quote(sceneId)} && authorId=${quote(authorId)}`));
  },
  lock(record: {
    workspaceId: string;
    sceneId: string;
    nodeId: string;
    holderKind: string;
    holderId: string;
    holderName: string;
    expiresAt: string;
  }): void {
    enqueue(() =>
      upsert('object_locks', `scene=${quote(record.sceneId)} && node=${quote(record.nodeId)}`, {
        workspace: record.workspaceId,
        scene: record.sceneId,
        node: record.nodeId,
        holderKind: record.holderKind,
        holderId: record.holderId,
        holderName: record.holderName,
        expiresAt: record.expiresAt,
      }),
    );
  },
  lockGone(sceneId: string, nodeId: string): void {
    enqueue(() => remove('object_locks', `scene=${quote(sceneId)} && node=${quote(nodeId)}`));
  },
  comment(record: {
    workspaceId: string;
    sceneId: string;
    commentId: string;
    nodeId: string;
    body: string;
    authorId: string;
    authorName: string;
    mentions: string[];
    resolved: boolean;
  }): void {
    enqueue(() =>
      upsert('comments', `commentId=${quote(record.commentId)}`, {
        workspace: record.workspaceId,
        scene: record.sceneId,
        commentId: record.commentId,
        node: record.nodeId,
        body: record.body,
        authorId: record.authorId,
        authorName: record.authorName,
        mentions: record.mentions,
        resolved: record.resolved,
      }),
    );
  },
};
