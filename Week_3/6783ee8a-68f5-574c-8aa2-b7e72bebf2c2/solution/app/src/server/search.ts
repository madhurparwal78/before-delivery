import { markdownHeadings } from "../shared/headings";
import { settings } from "./config";
import { pool, query } from "./db";
import type { Db } from "./db";
import { searchUnavailable } from "./errors";

const INDEX = "notebooks";
const TASK_TIMEOUT_MS = 20000;

export class SearchUnavailable extends Error {}

async function call(method: string, path: string, body?: unknown): Promise<unknown> {
  try {
    const response = await fetch(`${settings.meilisearch.url}${path}`, {
      method,
      headers: { authorization: `Bearer ${settings.meilisearch.apiKey}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    const text = await response.text();
    const parsed = text ? (JSON.parse(text) as unknown) : null;
    if (response.status >= 500 || (response.status >= 400 && response.status !== 404 && response.status !== 409)) {
      throw new SearchUnavailable(`Meilisearch answered ${response.status}: ${text.slice(0, 200)}`);
    }
    return parsed;
  } catch (error) {
    throw error instanceof SearchUnavailable ? error : new SearchUnavailable(String(error));
  }
}

/** Waits until Meilisearch reports a task as done; a failed task is an error. */
async function confirmed(task: unknown): Promise<void> {
  const uid = (task as { taskUid?: number } | null)?.taskUid;
  if (uid === undefined) throw new SearchUnavailable("Meilisearch returned no task");
  const deadline = Date.now() + TASK_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const state = (await call("GET", `/tasks/${uid}`)) as { status: string; error?: { message?: string } };
    if (state.status === "succeeded") return;
    if (state.status === "failed" || state.status === "canceled") throw new SearchUnavailable(state.error?.message ?? state.status);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new SearchUnavailable("Meilisearch task timed out");
}

let prepared = false;
let preparing: Promise<void> | null = null;

/** Creates the index and applies its settings; running it again changes nothing. */
function prepareIndex(): Promise<void> {
  if (prepared) return Promise.resolve();
  preparing ??= (async () => {
    try {
      const made = (await call("POST", "/indexes", { uid: INDEX, primaryKey: "id" })) as { taskUid?: number } | null;
      if (made?.taskUid !== undefined) await confirmed(made).catch(() => undefined);
      await confirmed(
        await call("PATCH", `/indexes/${INDEX}/settings`, {
          searchableAttributes: ["title", "headings", "cells"],
          filterableAttributes: ["reader_ids"],
        }),
      );
      prepared = true;
    } finally {
      preparing = null;
    }
  })();
  return preparing;
}

interface SearchDocument {
  id: string;
  title: string;
  cells: string[];
  headings: string[];
  reader_ids: string[];
}

async function documentOf(db: Db, notebookId: string): Promise<SearchDocument | null> {
  const [notebook] = await query<{ title: string; owner_id: string }>(db, "SELECT title, owner_id FROM notebooks WHERE id = $1", [notebookId]);
  if (!notebook) return null;
  const cells = await query<{ cell_type: string; source: string }>(db, "SELECT cell_type, source FROM cells WHERE notebook_id = $1 ORDER BY position", [notebookId]);
  const readers = await query<{ user_id: string }>(db, "SELECT user_id FROM shares WHERE notebook_id = $1 AND status = 'active' AND user_id IS NOT NULL", [notebookId]);
  return {
    id: notebookId,
    title: notebook.title,
    cells: cells.map((c) => c.source),
    headings: cells.filter((c) => c.cell_type === "markdown").flatMap((c) => markdownHeadings(c.source).map((h) => h.text)),
    reader_ids: [notebook.owner_id, ...readers.map((r) => r.user_id)],
  };
}

/** Sends one notebook's document (or its removal) and waits for Meilisearch to confirm the task. */
export async function syncNotebook(db: Db, notebookId: string): Promise<void> {
  await prepareIndex();
  const document = await documentOf(db, notebookId);
  const task = document
    ? await call("POST", `/indexes/${INDEX}/documents`, [document])
    : await call("DELETE", `/indexes/${INDEX}/documents/${encodeURIComponent(notebookId)}`);
  await confirmed(task);
}

/** Records that a notebook's document is stale; the indexer retries until Meilisearch confirms. */
export async function markStale(db: Db, notebookId: string): Promise<void> {
  await db.query(
    `INSERT INTO search_pending (notebook_id, op) VALUES ($1, 'sync')
     ON CONFLICT (notebook_id) DO UPDATE SET op = 'sync', queued_at = clock_timestamp()`,
    [notebookId],
  );
}

let kicking = false;
let again = false;

/** Works through the stale documents; failures stay queued and are retried on the next pass. */
export async function runIndexer(): Promise<void> {
  if (kicking) {
    again = true;
    return;
  }
  kicking = true;
  try {
    do {
      again = false;
      const pending = await query<{ notebook_id: string; queued_at: Date }>(pool, "SELECT notebook_id, queued_at FROM search_pending ORDER BY queued_at LIMIT 50");
      for (const item of pending) {
        try {
          await syncNotebook(pool, item.notebook_id);
          await pool.query("DELETE FROM search_pending WHERE notebook_id = $1 AND queued_at = $2", [item.notebook_id, item.queued_at]);
        } catch (error) {
          console.error("search sync waiting:", error instanceof Error ? error.message : error);
          break;
        }
      }
    } while (again);
  } finally {
    kicking = false;
  }
}

interface SearchHit {
  id: string;
}

/** Notebook ids Meilisearch matches for a reader, best first. */
export async function searchFor(userId: string, q: string): Promise<SearchHit[]> {
  try {
    await prepareIndex();
    const result = (await call("POST", `/indexes/${INDEX}/search`, {
      q,
      filter: `reader_ids = "${userId}"`,
      attributesToRetrieve: ["id"],
      limit: 200,
    })) as { hits?: SearchHit[] } | null;
    return result?.hits ?? [];
  } catch {
    throw searchUnavailable();
  }
}
