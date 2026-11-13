/** The Meilisearch index `transcript_items`: confirmed writes, mission-scoped reads. */

import { config, DEPENDENCY_TIMEOUT_MS } from "../config.js";
import { DependencyDown } from "../errors.js";

const INDEX = "transcript_items";
const TASK_WAIT_MS = 3000;

export type TranscriptDocument = {
  id: string;
  mission_id: string;
  pass_id: string;
  kind: "line" | "event";
  met: number;
  speaker: string | null;
  text: string;
};

type SearchDocumentHit = {
  kind: "line" | "event";
  pass_id: string;
  met: number;
  speaker: string | null;
  text: string;
};

async function call(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
  timeoutMs = DEPENDENCY_TIMEOUT_MS,
): Promise<{ status: number; body: unknown }> {
  try {
    const response = await fetch(`${config.meilisearch.url}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.meilisearch.apiKey}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status >= 500) throw new Error(`status ${response.status}`);
    const text = await response.text();
    const parsed: unknown = text.length > 0 ? JSON.parse(text) : null;
    return { status: response.status, body: parsed };
  } catch (error) {
    throw new DependencyDown("search", String(error));
  }
}

export async function probeSearch(): Promise<boolean> {
  try {
    const { status } = await call("GET", "/health");
    return status === 200;
  } catch {
    return false;
  }
}

export async function ensureIndex(): Promise<void> {
  await call("POST", "/indexes", { uid: INDEX, primaryKey: "id" });
  await call("PATCH", `/indexes/${INDEX}/settings`, {
    searchableAttributes: ["text", "speaker"],
    filterableAttributes: ["mission_id", "pass_id", "kind"],
    sortableAttributes: ["met"],
  });
}

type TaskRef = { taskUid?: number };

/** True when the engine reported the task `succeeded` within the wait. */
async function waitForTask(task: unknown): Promise<boolean> {
  const uid = (task as TaskRef).taskUid;
  if (uid === undefined) {
    return false;
  }
  const deadline = Date.now() + TASK_WAIT_MS;
  for (;;) {
    const { body } = await call("GET", `/tasks/${uid}`);
    const status = (body as { status?: string }).status;
    if (status === "succeeded") {
      return true;
    }
    if (status === "failed" || status === "canceled") {
      return false;
    }
    if (Date.now() >= deadline) {
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** Indexes documents, reporting whether the engine confirmed the write. */
export async function indexDocuments(documents: TranscriptDocument[]): Promise<boolean> {
  if (documents.length === 0) {
    return true;
  }
  const { body } = await call("PUT", `/indexes/${INDEX}/documents`, documents);
  return waitForTask(body);
}

export async function deletePassDocuments(passId: string): Promise<boolean> {
  const { body } = await call("POST", `/indexes/${INDEX}/documents/delete`, {
    filter: `pass_id = "${passId}"`,
  });
  return waitForTask(body);
}

export async function searchMission(
  missionId: string,
  query: string,
): Promise<SearchDocumentHit[]> {
  const { body } = await call("POST", `/indexes/${INDEX}/search`, {
    q: query,
    filter: `mission_id = "${missionId}"`,
    sort: ["met:asc"],
    limit: 50,
    attributesToRetrieve: ["kind", "pass_id", "met", "speaker", "text"],
  });
  const hits = (body as { hits?: unknown[] }).hits ?? [];
  return hits.map((hit) => {
    const row = hit as SearchDocumentHit;
    return {
      kind: row.kind,
      pass_id: row.pass_id,
      met: row.met,
      speaker: row.speaker ?? null,
      text: row.text,
    };
  });
}
