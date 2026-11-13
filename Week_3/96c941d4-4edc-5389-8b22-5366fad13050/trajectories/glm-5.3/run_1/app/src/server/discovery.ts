import { config } from './config.js';

// Meilisearch client for the published_challenges index.

const INDEX = 'published_challenges';

export interface SearchDoc {
  digest: string;
  ruleset: string;
  title: string;
  description: string;
  difficulty: string;
  creatorName: string;
}

interface TaskInfo {
  taskUid: number;
  status?: string;
}

async function meili(method: string, path: string, body?: unknown): Promise<{ ok: boolean; status: number; json?: any }> {
  try {
    const response = await fetch(`${config.meilisearch.url}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.meilisearch.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    let json: any;
    try {
      json = await response.json();
    } catch {
      json = undefined;
    }
    return { ok: response.ok, status: response.status, json };
  } catch {
    return { ok: false, status: 0 };
  }
}

export async function ensureIndex(): Promise<boolean> {
  // Create the index if absent, then apply settings idempotently, awaiting
  // provider task confirmation so filterable attributes are usable.
  const exists = await meili('GET', `/indexes/${INDEX}`);
  if (!exists.ok) {
    const create = await meili('POST', '/indexes', { uid: INDEX, primaryKey: 'digest' });
    if (!create.ok && create.status !== 400) return false;
    if (create.ok) {
      const uid = create.json?.taskUid;
      if (typeof uid === 'number' && !(await awaitTask(uid))) return false;
    }
  }
  const settings = {
    searchableAttributes: ['title', 'description', 'creatorName'],
    filterableAttributes: ['difficulty', 'ruleset'],
    sortableAttributes: ['title', 'digest'],
    typoTolerance: { enabled: false },
  };
  const update = await meili('PATCH', `/indexes/${INDEX}/settings`, settings);
  if (!update.ok) return false;
  const uid = update.json?.taskUid;
  if (typeof uid === 'number' && !(await awaitTask(uid))) return false;
  return true;
}

async function awaitTask(taskUid: number): Promise<boolean> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const status = await meili('GET', `/tasks/${taskUid}`);
    const task = status.json as TaskInfo | undefined;
    if (status.ok && task && typeof task.status === 'string') {
      if (task.status === 'succeeded') return true;
      if (task.status === 'failed') return false;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

export async function upsertDocuments(docs: SearchDoc[]): Promise<boolean> {
  const result = await meili('POST', `/indexes/${INDEX}/documents?primaryKey=digest`, docs);
  return result.ok;
}

export async function deleteDocuments(digests: string[]): Promise<boolean> {
  if (digests.length === 0) return true;
  const result = await meili('POST', `/indexes/${INDEX}/documents/delete-batch`, digests);
  return result.ok;
}

export async function waitForTasks(taskUids: number[]): Promise<boolean> {
  for (const uid of taskUids) {
    let attempts = 0;
    while (attempts < 20) {
      const status = await meili('GET', `/tasks/${uid}`);
      const task = status.json as TaskInfo | undefined;
      if (task && typeof task.status === 'string' && task.status !== 'enqueued' && task.status !== 'processing') {
        if (task.status === 'succeeded') break;
        return false;
      }
      attempts++;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  return true;
}

export interface SearchResult {
  ok: boolean;
  digests: string[];
}

export async function search(text: string, difficulty: string | null, ruleset: string | null): Promise<SearchResult> {
  const filterParts: string[] = [];
  if (difficulty) filterParts.push(`difficulty = "${difficulty}"`);
  if (ruleset) filterParts.push(`ruleset = "${ruleset}"`);
  const body: Record<string, unknown> = {
    q: text,
    limit: 1000,
  };
  if (filterParts.length > 0) body.filter = filterParts.join(' AND ');
  const result = await meili('POST', `/indexes/${INDEX}/search`, body);
  if (!result.ok) return { ok: false, digests: [] };
  const hits = (result.json?.hits ?? []) as Array<{ digest: string }>;
  return { ok: true, digests: hits.map((h) => h.digest) };
}

export async function getTaskStatus(taskUid: number): Promise<'succeeded' | 'failed' | 'processing' | 'unknown'> {
  const status = await meili('GET', `/tasks/${taskUid}`);
  const task = status.json as TaskInfo | undefined;
  if (!status.ok || !task) return 'unknown';
  if (task.status === 'succeeded') return 'succeeded';
  if (task.status === 'failed') return 'failed';
  return 'processing';
}
