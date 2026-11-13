import { meili } from "./config.ts";
import { logger } from "./logger.ts";

async function call(method: string, path: string, body?: unknown, query?: Record<string, string>): Promise<unknown> {
  const url = new URL(`${meili.url}${path}`);
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const response = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${meili.apiKey}`,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(8_000),
  });
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = text === "" ? {} : JSON.parse(text);
  } catch {
    throw new Error(`meilisearch returned invalid JSON (status ${response.status})`);
  }
  if (!response.ok) {
    const record = parsed as Record<string, unknown>;
    throw new Error(`meilisearch ${path} failed: ${String(record.message ?? response.status)}`);
  }
  return parsed;
}

export type MeiliTask = { uid: number };

async function waitForTask(taskUid: number): Promise<boolean> {
  let delay = 20;
  for (let attempt = 0; attempt < 25; attempt++) {
    try {
      const task = (await call("GET", `/tasks/${taskUid}`)) as { status?: string };
      if (task.status === "succeeded") return true;
      if (task.status === "failed") return false;
    } catch (err) {
      logger.warn(`meilisearch task ${taskUid} poll: ${(err as Error).message}`);
      if (attempt === 24) return false;
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(delay * 2, 400);
  }
  return false;
}

export type SearchDoc = {
  id: string;
  title: string;
  cells: string[];
  headings: string[];
  reader_ids: string[];
};

export async function applySettings(): Promise<boolean> {
  try {
    const task = (await call("PATCH", "/indexes/notebooks/settings", {
      searchableAttributes: ["title", "headings", "cells"],
      filterableAttributes: ["reader_ids"],
    })) as MeiliTask;
    if (!(await waitForTask(task.uid))) return false;
    const createTask = (await call("POST", "/indexes", { uid: "notebooks", primaryKey: "id" })) as MeiliTask;
    await waitForTask(createTask.uid);
    return true;
  } catch (err) {
    logger.warn(`meilisearch settings: ${(err as Error).message}`);
    return false;
  }
}

export async function putDoc(doc: SearchDoc): Promise<boolean> {
  try {
    const task = (await call("POST", "/indexes/notebooks/documents", [doc])) as MeiliTask;
    return await waitForTask(task.uid);
  } catch (err) {
    logger.warn(`meilisearch putDoc: ${(err as Error).message}`);
    return false;
  }
}

export async function deleteDoc(notebookId: string): Promise<boolean> {
  try {
    const task = (await call("DELETE", `/indexes/notebooks/documents/${notebookId}`)) as MeiliTask;
    return await waitForTask(task.uid);
  } catch (err) {
    logger.warn(`meilisearch deleteDoc: ${(err as Error).message}`);
    return false;
  }
}

export async function search(query: string, userId: string): Promise<{ ok: true; ids: string[] } | { ok: false }> {
  try {
    const result = (await call("POST", `/indexes/notebooks/search`, {
      q: query,
      filter: `reader_ids = ${JSON.stringify(userId)}`,
      limit: 50,
    })) as { hits: { id: string }[] };
    return { ok: true, ids: result.hits.map((hit) => hit.id) };
  } catch (err) {
    logger.warn(`meilisearch search: ${(err as Error).message}`);
    return { ok: false };
  }
}

export async function isUp(): Promise<boolean> {
  try {
    await call("GET", "/health");
    return true;
  } catch {
    return false;
  }
}

/** Updates Meilisearch did not confirm are retried until it does. */
const pendingDocs = new Map<string, SearchDoc>();
let retryTimer: ReturnType<typeof setInterval> | null = null;

function ensureRetryLoop(): void {
  if (retryTimer !== null) return;
  retryTimer = setInterval(() => {
    for (const doc of [...pendingDocs.values()]) {
      void putDoc(doc).then((ok) => {
        if (ok) pendingDocs.delete(doc.id);
      });
    }
  }, 10_000);
  retryTimer.unref();
}

export function forgetPending(notebookId: string): void {
  pendingDocs.delete(notebookId);
}

/** Puts the search document and keeps it queued for retry until Meilisearch confirms. */
export async function syncDoc(doc: SearchDoc): Promise<boolean> {
  const ok = await putDoc(doc);
  if (!ok) {
    pendingDocs.set(doc.id, doc);
    ensureRetryLoop();
  } else {
    pendingDocs.delete(doc.id);
  }
  return ok;
}
