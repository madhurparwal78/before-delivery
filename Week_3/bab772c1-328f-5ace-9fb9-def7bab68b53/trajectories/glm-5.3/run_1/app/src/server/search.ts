// Meilisearch transcript search. One index, settings created idempotently at
// start or as soon as search first answers. Confirmed writes wait up to
// 3 seconds for the engine task to report succeeded.

import { DependencyError, optionalEnv, requireEnv } from "./deps.js";
import { fetchWithTimeout } from "./deps.js";

const INDEX = "transcript_items";
const TASK_TIMEOUT_MS = 3000;

export interface LineDocument {
  id: string;
  mission_id: string;
  pass_id: string;
  kind: "line";
  met: number;
  speaker: string;
  text: string;
}

export interface EventDocument {
  id: string;
  mission_id: string;
  pass_id: string;
  kind: "event";
  met: number;
  speaker: null;
  text: string;
}

export type SearchDocument = LineDocument | EventDocument;

export interface SearchHit {
  id: string;
  met: number;
  speaker: string | null;
  text: string;
}

function baseUrl(): string {
  return requireEnv("MEILISEARCH_URL").replace(/\/$/, "");
}

function apiKey(): string | undefined {
  return optionalEnv("MEILISEARCH_API_KEY");
}

async function call<T>(path: string, init: RequestInit, timeoutMs = 3000): Promise<T> {
  const headers = new Headers(init.headers);
  const key = apiKey();
  if (key) headers.set("Authorization", `Bearer ${key}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  let response: Response;
  try {
    response = await fetchWithTimeout(`${baseUrl()}${path}`, { ...init, headers }, timeoutMs);
  } catch {
    throw new DependencyError("search");
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new SearchHttpError(response.status, text);
  }
  return (await response.json()) as T;
}

export class SearchHttpError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(status: number, body: string) {
    super(`meilisearch ${status}`);
    this.status = status;
    this.body = body;
  }
}

interface TaskStatus {
  taskUid: number;
  status: string;
}

export async function ensureIndex(): Promise<void> {
  const existing = await call(`/indexes/${INDEX}`, { method: "GET" }, 3000).then(
    () => true,
    (err: unknown) => !(err instanceof SearchHttpError),
  );
  if (!existing) {
    const task = await call<TaskStatus>(`/indexes?primaryKey=id`, {
      method: "POST",
      body: JSON.stringify({ uid: INDEX }),
    });
    await waitForTask(task.taskUid);
  }
  const settings = await call<TaskStatus>(`/indexes/${INDEX}/settings`, {
    method: "PATCH",
    body: JSON.stringify({
      searchableAttributes: ["text", "speaker"],
      filterableAttributes: ["mission_id", "pass_id", "kind"],
      sortableAttributes: ["met"],
    }),
  });
  await waitForTask(settings.taskUid);
}

export async function waitForTask(taskUid: number): Promise<boolean> {
  const deadline = Date.now() + TASK_TIMEOUT_MS;
  for (;;) {
    const task = await call<TaskStatus>(`/tasks/${taskUid}`, { method: "GET" }).catch(() => null);
    if (task && task.status === "succeeded") return true;
    if (task && (task.status === "failed" || task.status === "canceled")) return false;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

export interface WriteOutcome {
  confirmed: boolean;
}

export async function upsertDocuments(
  documents: SearchDocument[],
): Promise<WriteOutcome> {
  if (documents.length === 0) return { confirmed: true };
  let task: TaskStatus | null = null;
  try {
    task = await call<TaskStatus>(`/indexes/${INDEX}/documents?primaryKey=id`, {
      method: "POST",
      body: JSON.stringify(documents),
    });
  } catch (err) {
    if (err instanceof SearchHttpError) {
      console.error("meilisearch upsert rejected", err.status, err.body.slice(0, 200));
    }
    return { confirmed: false };
  }
  if (!task) return { confirmed: false };
  return { confirmed: await waitForTask(task.taskUid) };
}

export async function deleteDocumentsByPassId(passId: string): Promise<WriteOutcome> {
  let task: TaskStatus | null = null;
  try {
    task = await call<TaskStatus>(`/indexes/${INDEX}/documents/delete`, {
      method: "POST",
      body: JSON.stringify({ filter: `pass_id = "${passId}"` }),
    });
  } catch (err) {
    if (err instanceof SearchHttpError) {
      console.error("meilisearch delete rejected", err.status, err.body.slice(0, 200));
    }
    return { confirmed: false };
  }
  if (!task) return { confirmed: false };
  return { confirmed: await waitForTask(task.taskUid) };
}

export interface SearchOptions {
  missionId: string;
  query: string;
  limit: number;
}

export async function searchDocuments(options: SearchOptions): Promise<SearchHit[]> {
  const result = await call<{ hits: Array<{ id: string; met: number; speaker: string | null; text: string; kind: string }> }>(
    `/indexes/${INDEX}/search`,
    {
      method: "POST",
      body: JSON.stringify({
        q: options.query,
        filter: `mission_id = "${options.missionId}"`,
        limit: options.limit,
        sort: ["met:asc"],
        attributesToRetrieve: ["id", "met", "speaker", "text", "kind"],
      }),
    },
  ).catch((err) => {
    if (err instanceof DependencyError) throw err;
    throw new DependencyError("search");
  });
  return result.hits
    .map((h) => ({ id: h.id, met: h.met, speaker: h.speaker ?? null, text: h.text, kind: h.kind }))
    .sort((a, b) => a.met - b.met);
}

export async function probeSearch(): Promise<boolean> {
  try {
    await call("/health", { method: "GET" }, 1000);
    return true;
  } catch {
    return false;
  }
}
