import { config } from './config.js';

/** Raised when Meilisearch cannot be reached or refuses a call. */
export class SearchFailure extends Error {}

const INDEX = 'notebooks';
const TIMEOUT_MS = 5000;
const TASK_WAIT_MS = 5000;

export interface SearchDocument {
  id: string;
  title: string;
  cells: string[];
  headings: string[];
  reader_ids: string[];
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${config.search.url}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${config.search.apiKey}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new SearchFailure(`${method} ${path} failed`);
  }
  if (!response.ok) throw new SearchFailure(`${method} ${path} answered ${response.status}`);
  return (await response.json()) as T;
}

/** Waits until Meilisearch confirms the task, so a document is really there. */
async function awaitTask(taskUid: number): Promise<void> {
  const deadline = Date.now() + TASK_WAIT_MS;
  for (;;) {
    const task = await call<{ status: string }>('GET', `/tasks/${taskUid}`);
    if (task.status === 'succeeded') return;
    if (task.status === 'failed' || task.status === 'canceled') {
      throw new SearchFailure(`task ${taskUid} ${task.status}`);
    }
    if (Date.now() > deadline) throw new SearchFailure(`task ${taskUid} did not finish`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

export async function applyIndexSettings(): Promise<void> {
  const indexes = await call<{ results: { uid: string }[] }>('GET', '/indexes?limit=100');
  if (!indexes.results.some((index) => index.uid === INDEX)) {
    const created = await call<{ taskUid: number }>('POST', '/indexes', { uid: INDEX, primaryKey: 'id' });
    await awaitTask(created.taskUid);
  }
  const settings = await call<{ taskUid: number }>('PATCH', `/indexes/${INDEX}/settings`, {
    searchableAttributes: ['title', 'headings', 'cells'],
    filterableAttributes: ['reader_ids'],
  });
  await awaitTask(settings.taskUid);
}

export async function indexNotebook(document: SearchDocument): Promise<void> {
  const task = await call<{ taskUid: number }>('PUT', `/indexes/${INDEX}/documents`, [document]);
  await awaitTask(task.taskUid);
}

export async function removeNotebookFromIndex(notebookId: string): Promise<void> {
  const task = await call<{ taskUid: number }>('DELETE', `/indexes/${INDEX}/documents/${notebookId}`);
  await awaitTask(task.taskUid);
}

export async function searchNotebooks(queryText: string, readerId: string): Promise<{ id: string; title: string }[]> {
  const result = await call<{ hits: { id: string; title: string }[] }>('POST', `/indexes/${INDEX}/search`, {
    q: queryText,
    filter: `reader_ids = "${readerId}"`,
    limit: 100,
    attributesToRetrieve: ['id', 'title'],
  });
  return result.hits.map((hit) => ({ id: hit.id, title: hit.title }));
}
