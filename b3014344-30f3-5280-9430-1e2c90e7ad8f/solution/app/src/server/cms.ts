import { config } from "./config";
import { errors, HttpError } from "./http";
import { studioInstant } from "./time";
import type { Entry, EntryKind, EntryStatus, EntrySummary, StudioEntry } from "../shared/domain";

// PocketBase holds case studies and journal posts in the `entries` collection, read and written
// server-side as the app admin. Every call authenticates and connects afresh.

const BASE = config.pocketbase.url;

interface PbRecord {
  id: string;
  kind: EntryKind;
  slug: string;
  title: string;
  client: string;
  year: number | null;
  summary: string;
  body: string;
  status: EntryStatus;
  publishedAt: string;
}

async function call(method: string, path: string, body?: unknown, token?: string): Promise<{ status: number; json: unknown }> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: token } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    throw errors.cms();
  }
  if (response.status >= 500) throw errors.cms();
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : null };
}

async function token(): Promise<string> {
  const auth = await call("POST", "/api/admins/auth-with-password", {
    identity: config.pocketbase.email,
    password: config.pocketbase.password,
  });
  if (auth.status !== 200) throw errors.cms();
  return (auth.json as { token: string }).token;
}

export async function cmsHealthy(): Promise<boolean> {
  try {
    const response = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(1_500) });
    return response.status === 200;
  } catch {
    return false;
  }
}

const COLLECTION = {
  name: "entries",
  type: "base",
  schema: [
    { name: "kind", type: "select", required: true, options: { maxSelect: 1, values: ["case_study", "journal"] } },
    { name: "slug", type: "text", required: true, options: { pattern: "^[a-z0-9-]+$" } },
    { name: "title", type: "text", required: true, options: {} },
    { name: "client", type: "text", required: false, options: {} },
    { name: "year", type: "number", required: false, options: { noDecimal: true } },
    { name: "summary", type: "text", required: false, options: {} },
    { name: "body", type: "text", required: false, options: {} },
    { name: "status", type: "select", required: true, options: { maxSelect: 1, values: ["draft", "published", "withdrawn"] } },
    { name: "publishedAt", type: "date", required: false, options: {} },
  ],
  indexes: ["CREATE UNIQUE INDEX `idx_entries_slug` ON `entries` (`slug`)"],
  listRule: null,
  viewRule: null,
  createRule: null,
  updateRule: null,
  deleteRule: null,
};

export async function ensureCollection(): Promise<void> {
  const admin = await token();
  const found = await call("GET", "/api/collections/entries", undefined, admin);
  if (found.status === 200) return;
  const created = await call("POST", "/api/collections", COLLECTION, admin);
  if (created.status !== 200 && (await call("GET", "/api/collections/entries", undefined, admin)).status !== 200) {
    throw errors.cms();
  }
}

/** PocketBase dates are UTC `YYYY-MM-DD HH:MM:SS.sssZ`; the API speaks studio-offset ISO instants. */
function publishedInstant(value: string): string | null {
  if (!value) return null;
  return studioInstant(new Date(value.replace(" ", "T")));
}

function pbDate(at: Date): string {
  return at.toISOString().replace("T", " ");
}

function summary(record: PbRecord): EntrySummary {
  return {
    slug: record.slug,
    title: record.title,
    client: record.client || null,
    year: record.year || null,
    summary: record.summary,
    publishedAt: publishedInstant(record.publishedAt) ?? "",
  };
}

function studioEntry(record: PbRecord): StudioEntry {
  return {
    id: record.id,
    kind: record.kind,
    slug: record.slug,
    title: record.title,
    client: record.client || null,
    year: record.year || null,
    summary: record.summary,
    status: record.status,
    publishedAt: publishedInstant(record.publishedAt),
  };
}

// PocketBase filter matching every given field exactly; values are slugs and enum words, never quotes.
function matching(fields: Record<string, string>): string {
  return Object.entries(fields)
    .map(([field, value]) => `${field}="${value}"`)
    .join(" && ");
}

async function list(fields: Record<string, string>, sort: string): Promise<PbRecord[]> {
  const admin = await token();
  const query = new URLSearchParams({ perPage: "500", filter: matching(fields), sort });
  const response = await call("GET", `/api/collections/entries/records?${query}`, undefined, admin);
  if (response.status !== 200) throw errors.cms();
  return (response.json as { items: PbRecord[] }).items;
}

export async function publishedEntries(kind: EntryKind): Promise<EntrySummary[]> {
  return (await list({ kind, status: "published" }, "-publishedAt,-created")).map(summary);
}

export async function publishedEntry(kind: EntryKind, slug: string): Promise<Entry | null> {
  if (!/^[a-z0-9-]+$/.test(slug)) return null;
  const [record] = await list({ kind, status: "published", slug }, "-publishedAt");
  return record ? { ...summary(record), body: record.body } : null;
}

export async function allEntries(): Promise<StudioEntry[]> {
  return (await list({}, "-created")).map(studioEntry);
}

export interface NewEntry {
  kind: EntryKind;
  slug: string;
  title: string;
  client: string;
  year: number | null;
  summary: string;
  body: string;
  status?: EntryStatus;
  publishedAt?: Date;
}

export async function slugTaken(slug: string): Promise<boolean> {
  return (await list({ slug }, "-created")).length > 0;
}

export async function createEntry(entry: NewEntry): Promise<StudioEntry> {
  const admin = await token();
  const response = await call(
    "POST",
    "/api/collections/entries/records",
    {
      ...entry,
      status: entry.status ?? "draft",
      publishedAt: entry.publishedAt ? pbDate(entry.publishedAt) : "",
    },
    admin,
  );
  if (response.status === 400) throw errors.invalid({ slug: "That slug is already used by another entry." });
  if (response.status !== 200) throw errors.cms();
  return studioEntry(response.json as PbRecord);
}

/** Entries move draft → published → withdrawn only. */
const NEXT: Record<"publish" | "withdraw", { from: EntryStatus; to: EntryStatus }> = {
  publish: { from: "draft", to: "published" },
  withdraw: { from: "published", to: "withdrawn" },
};

export async function moveEntry(id: string, action: "publish" | "withdraw"): Promise<StudioEntry> {
  const admin = await token();
  if (!/^[a-z0-9]{15}$/.test(id)) throw errors.notFound();
  const found = await call("GET", `/api/collections/entries/records/${id}`, undefined, admin);
  if (found.status === 404) throw errors.notFound();
  if (found.status !== 200) throw errors.cms();
  const record = found.json as PbRecord;
  const move = NEXT[action];
  if (record.status !== move.from) {
    throw new HttpError(409, "invalid_transition", `That move isn't allowed while this entry is ${record.status}.`);
  }
  const patch = action === "publish" ? { status: move.to, publishedAt: pbDate(new Date()) } : { status: move.to };
  const updated = await call("PATCH", `/api/collections/entries/records/${id}`, patch, admin);
  if (updated.status !== 200) throw errors.cms();
  return studioEntry(updated.json as PbRecord);
}
