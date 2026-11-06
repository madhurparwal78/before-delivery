// PocketBase: the live collaboration layer for presence, object locks and comment threads.
import { config } from "../config.js";
import { isRecord } from "../../shared/graph.js";

export type PbRecord = Record<string, unknown> & { id: string; created: string };

type Field = { name: string; type: "text" | "date" | "json" | "bool"; required?: boolean };

const COLLECTIONS: { name: string; schema: Field[]; indexes: string[] }[] = [
  {
    name: "presence",
    schema: [
      { name: "workspace", type: "text", required: true }, { name: "scene", type: "text", required: true },
      { name: "authorKind", type: "text", required: true }, { name: "authorId", type: "text", required: true },
      { name: "authorName", type: "text" }, { name: "selection", type: "text" }, { name: "cursor", type: "json" },
      { name: "seenAt", type: "date" },
    ],
    indexes: ["CREATE UNIQUE INDEX `idx_presence_author` ON `presence` (`scene`, `authorKind`, `authorId`)"],
  },
  {
    name: "object_locks",
    schema: [
      { name: "workspace", type: "text", required: true }, { name: "scene", type: "text", required: true },
      { name: "node", type: "text", required: true }, { name: "holderKind", type: "text", required: true },
      { name: "holderId", type: "text", required: true }, { name: "holderName", type: "text" }, { name: "expiresAt", type: "date" },
    ],
    indexes: ["CREATE UNIQUE INDEX `idx_object_locks_node` ON `object_locks` (`scene`, `node`)"],
  },
  {
    name: "comments",
    schema: [
      { name: "workspace", type: "text", required: true }, { name: "scene", type: "text", required: true },
      { name: "commentId", type: "text", required: true }, { name: "node", type: "text", required: true },
      { name: "body", type: "text", required: true }, { name: "authorId", type: "text" }, { name: "authorName", type: "text" },
      { name: "mentions", type: "json" }, { name: "resolved", type: "bool" },
    ],
    indexes: ["CREATE UNIQUE INDEX `idx_comments_id` ON `comments` (`commentId`)"],
  },
];

let token: string | null = null;
let ready: Promise<void> | null = null;

async function authenticate(): Promise<string> {
  const response = await fetch(`${config.pocketbase.url}/api/admins/auth-with-password`, {
    method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({ identity: config.pocketbase.email, password: config.pocketbase.password }),
  });
  const body: unknown = await response.json();
  if (!response.ok || !isRecord(body) || typeof body.token !== "string") throw new Error(`PocketBase sign-in failed (${response.status})`);
  return body.token;
}

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; body: unknown }> {
  token ??= await authenticate();
  const attempt = () => fetch(`${config.pocketbase.url}${path}`, {
    method, signal: AbortSignal.timeout(10_000),
    headers: { authorization: token ?? "", ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let response = await attempt();
  if (response.status === 401) {
    token = await authenticate();
    response = await attempt();
  }
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) as unknown : null };
}

async function createCollections(): Promise<void> {
  for (const collection of COLLECTIONS) {
    const existing = await call("GET", `/api/collections/${collection.name}`);
    if (existing.status === 200) continue;
    const schema = collection.schema.map((f) => (f.type === "json" ? { ...f, options: { maxSize: 200_000 } } : f));
    const created = await call("POST", "/api/collections", { name: collection.name, type: "base", schema, indexes: collection.indexes });
    if (created.status !== 200 && (await call("GET", `/api/collections/${collection.name}`)).status !== 200) {
      throw new Error(`PocketBase collection ${collection.name} could not be created`);
    }
  }
}

/** Creates the collections once PocketBase is reachable; a failed attempt is retried by the next caller. */
export function ensureCollections(): Promise<void> {
  ready ??= createCollections().catch((error: unknown) => { ready = null; throw error; });
  return ready;
}

export const quote = (value: string) => `"${value.replace(/["\\]/g, "")}"`;

function asRecord(value: unknown): PbRecord {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.created !== "string") throw new Error("PocketBase returned a malformed record");
  const record: PbRecord = { ...value, id: value.id, created: value.created };
  return record;
}

export async function list(collection: string, filter: string): Promise<PbRecord[]> {
  await ensureCollections();
  const found: PbRecord[] = [];
  for (let page = 1; ; page++) {
    const query = new URLSearchParams({ perPage: "500", page: String(page), filter, sort: "created" });
    const response = await call("GET", `/api/collections/${collection}/records?${query}`);
    if (response.status !== 200 || !isRecord(response.body) || !Array.isArray(response.body.items)) throw new Error(`PocketBase list ${collection} failed`);
    found.push(...response.body.items.map(asRecord));
    if (response.body.items.length < 500) return found;
  }
}

/** Creates a record; returns null when a unique index already holds one for the same key. */
export async function create(collection: string, data: Record<string, unknown>): Promise<PbRecord | null> {
  await ensureCollections();
  const response = await call("POST", `/api/collections/${collection}/records`, data);
  if (response.status === 200) return asRecord(response.body);
  if (response.status === 400 && JSON.stringify(response.body).includes("validation_not_unique")) return null;
  throw new Error(`PocketBase create ${collection} failed (${response.status})`);
}

/** Creates a record that has no unique key to contend for. */
export async function insert(collection: string, data: Record<string, unknown>): Promise<PbRecord> {
  const record = await create(collection, data);
  if (!record) throw new Error(`PocketBase refused a new ${collection} record`);
  return record;
}

export async function update(collection: string, id: string, data: Record<string, unknown>): Promise<PbRecord | null> {
  await ensureCollections();
  const response = await call("PATCH", `/api/collections/${collection}/records/${id}`, data);
  if (response.status === 404) return null;
  if (response.status !== 200) throw new Error(`PocketBase update ${collection} failed (${response.status})`);
  return asRecord(response.body);
}

/** Deletes a record; false when it was already gone. */
export async function remove(collection: string, id: string): Promise<boolean> {
  await ensureCollections();
  const response = await call("DELETE", `/api/collections/${collection}/records/${id}`);
  if (response.status === 404) return false;
  if (response.status !== 204) throw new Error(`PocketBase delete ${collection} failed (${response.status})`);
  return true;
}

/** PocketBase writes dates as `YYYY-MM-DD HH:mm:ss.sssZ`. */
export function pbDate(value: unknown): Date {
  return new Date(typeof value === "string" ? value.replace(" ", "T") : 0);
}
