import { config } from "../config.ts";
import { call, ProviderDown } from "./call.ts";

const TASK_POLL_MS = 25;
const TASK_WAIT_MS = 5000;
const RESULT_LIMIT = 20;

type EntryKind = "material" | "client" | "piece";

export interface SearchEntry {
  id: string;
  deskId: string;
  kind: EntryKind;
  refId: string;
  label: string;
  href: string;
}

function entryId(deskId: string, kind: EntryKind, refId: string): string {
  return `${deskId}-${kind}-${refId}`;
}

export function entryOfMaterial(deskId: string, material: { code: string; name: string }): SearchEntry {
  return { id: entryId(deskId, "material", material.code), deskId, kind: "material", refId: material.code, label: `${material.name} ${material.code}`, href: `/library?material=${material.code}` };
}

export function entryOfClient(deskId: string, client: { id: string; name: string }): SearchEntry {
  return { id: entryId(deskId, "client", client.id), deskId, kind: "client", refId: client.id, label: client.name, href: `/clients/${client.id}` };
}

export function entryOfPiece(deskId: string, piece: { id: string; title: string }): SearchEntry {
  return { id: entryId(deskId, "piece", piece.id), deskId, kind: "piece", refId: piece.id, label: piece.title, href: `/pieces/${piece.id}` };
}

export function clientEntryId(deskId: string, clientId: string): string {
  return entryId(deskId, "client", clientId);
}

export function pieceEntryId(deskId: string, pieceId: string): string {
  return entryId(deskId, "piece", pieceId);
}

function engine(path: string, method: string, body?: unknown): Promise<Response> {
  return call(`${config.meilisearch.url}${path}`, {
    method,
    headers: { Authorization: `Bearer ${config.meilisearch.apiKey}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const indexPath = `/indexes/${config.meilisearch.index}`;

/** Waits for one engine task to succeed; only then is its write confirmed. */
async function confirmed(answer: Response): Promise<void> {
  if (!answer.ok) throw new ProviderDown(`engine answered ${answer.status}`);
  const { taskUid } = (await answer.json()) as { taskUid: number };
  const deadline = Date.now() + TASK_WAIT_MS;
  while (Date.now() < deadline) {
    const task = (await (await engine(`/tasks/${taskUid}`, "GET")).json()) as { status: string };
    if (task.status === "succeeded") return;
    if (task.status === "failed" || task.status === "canceled") throw new ProviderDown(`engine task ${task.status}`);
    await new Promise((resolve) => setTimeout(resolve, TASK_POLL_MS));
  }
  throw new ProviderDown("engine task timed out");
}

let indexReady = false;

async function ensureIndex(): Promise<void> {
  if (indexReady) return;
  const made = await engine("/indexes", "POST", { uid: config.meilisearch.index, primaryKey: "id" });
  if (!made.ok) throw new ProviderDown(`engine answered ${made.status}`);
  await engine(`${indexPath}/settings`, "PATCH", {
    searchableAttributes: ["label"],
    filterableAttributes: ["deskId"],
    typoTolerance: { enabled: true, minWordSizeForTypos: { oneTypo: 5, twoTypos: 9 } },
  }).then(confirmed);
  indexReady = true;
}

export async function addEntries(entries: SearchEntry[]): Promise<void> {
  await ensureIndex();
  await confirmed(await engine(`${indexPath}/documents`, "POST", entries));
}

export async function removeEntries(ids: string[]): Promise<void> {
  await ensureIndex();
  await confirmed(await engine(`${indexPath}/documents/delete-batch`, "POST", ids));
}

export async function searchEntries(deskId: string, q: string): Promise<SearchEntry[]> {
  const answer = await engine(`${indexPath}/search`, "POST", { q, filter: `deskId = "${deskId}"`, limit: RESULT_LIMIT });
  if (!answer.ok) throw new ProviderDown(`engine answered ${answer.status}`);
  return ((await answer.json()) as { hits: SearchEntry[] }).hits;
}

/** Replaces the whole index with what the database holds, whatever the engine had. */
async function replaceEntries(entries: SearchEntry[]): Promise<void> {
  await ensureIndex();
  await confirmed(await engine(`${indexPath}/documents`, "DELETE"));
  if (entries.length > 0) await confirmed(await engine(`${indexPath}/documents`, "POST", entries));
}

let chain: Promise<unknown> = Promise.resolve();
let outOfStep = true;

/** A desk write's index change: never holds the write up. One the engine misses leaves the index to be rebuilt from the database. */
export function syncEntries(add: SearchEntry[], remove: string[] = []): void {
  chain = chain.then(async () => {
    try {
      if (add.length > 0) await addEntries(add);
      if (remove.length > 0) await removeEntries(remove);
    } catch (error) {
      if (!(error instanceof ProviderDown)) throw error;
      outOfStep = true;
    }
  });
}

/** Rebuilds through the same queue, when the start's build or a missed write calls for it. */
export function rebuildIfOutOfStep(read: () => Promise<SearchEntry[]>): Promise<void> {
  const pass = chain.then(async () => {
    if (!outOfStep) return;
    try {
      await replaceEntries(await read());
      outOfStep = false;
    } catch (error) {
      if (!(error instanceof ProviderDown)) throw error;
    }
  });
  chain = pass;
  return pass;
}
