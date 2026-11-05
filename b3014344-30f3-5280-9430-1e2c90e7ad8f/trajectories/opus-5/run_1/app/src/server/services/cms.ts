import { config } from "../config.js";
import { errors } from "../errors.js";

export type EntryKind = "case_study" | "journal";
export type EntryStatus = "draft" | "published" | "withdrawn";

export interface CmsEntry {
  id: string;
  kind: EntryKind;
  slug: string;
  title: string;
  client: string;
  year: number;
  summary: string;
  body: string;
  status: EntryStatus;
  publishedAt: string | null;
}

interface CmsRecord {
  id: string;
  kind: string;
  slug: string;
  title: string;
  client: string;
  year: number;
  summary: string;
  body: string;
  status: string;
  publishedAt: string;
}

let adminToken: string | null = null;

async function callCms(
  method: string,
  path: string,
  body?: unknown,
  token?: string | null,
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = token;
  let response: Response;
  try {
    response = await fetch(`${config.cms.url}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw errors.cmsUnavailable();
  }
  if (response.status >= 500) {
    await response.text().catch(() => "");
    throw errors.cmsUnavailable();
  }
  const text = await response.text();
  let parsed: unknown = null;
  if (text.trim().length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  return { status: response.status, body: parsed };
}

async function authenticate(): Promise<string> {
  const response = await callCms("POST", "/api/admins/auth-with-password", {
    identity: config.cms.adminEmail,
    password: config.cms.adminPassword,
  });
  const token = (response.body as { token?: string } | null)?.token;
  if (!token) throw errors.cmsUnavailable();
  adminToken = token;
  return token;
}

async function asAdmin(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const token = adminToken ?? (await authenticate());
  const first = await callCms(method, path, body, token);
  if (first.status !== 401 && first.status !== 403) return first;
  adminToken = null;
  return callCms(method, path, body, await authenticate());
}

export async function reachable(): Promise<boolean> {
  try {
    const response = await fetch(`${config.cms.url}/api/health`, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch {
    return false;
  }
}

const FIELDS = [
  { name: "kind", type: "text", required: true },
  { name: "slug", type: "text", required: true },
  { name: "title", type: "text", required: true },
  { name: "client", type: "text" },
  { name: "year", type: "number" },
  { name: "summary", type: "text" },
  { name: "body", type: "text" },
  { name: "status", type: "text", required: true },
  { name: "publishedAt", type: "text" },
];

export async function ensureCollection(): Promise<void> {
  const existing = await asAdmin("GET", "/api/collections/entries");
  if (existing.status === 200) return;
  const created = await asAdmin("POST", "/api/collections", {
    name: "entries",
    type: "base",
    schema: FIELDS,
  });
  if (created.status !== 200 && created.status !== 400) {
    throw new Error(`pocketbase refused the entries collection: ${created.status}`);
  }
}

function toEntry(record: CmsRecord): CmsEntry {
  return {
    id: record.id,
    kind: record.kind === "journal" ? "journal" : "case_study",
    slug: record.slug,
    title: record.title,
    client: record.client ?? "",
    year: Number(record.year ?? 0),
    summary: record.summary ?? "",
    body: record.body ?? "",
    status: (record.status as EntryStatus) ?? "draft",
    publishedAt: record.publishedAt === "" ? null : record.publishedAt,
  };
}

async function fetchRecords(filter: string, sort: string): Promise<CmsEntry[]> {
  const search = new URLSearchParams({ perPage: "200", sort });
  if (filter) search.set("filter", filter);
  const response = await asAdmin("GET", `/api/collections/entries/records?${search.toString()}`);
  if (response.status !== 200) throw errors.cmsUnavailable();
  const items = (response.body as { items?: CmsRecord[] } | null)?.items ?? [];
  return items.map(toEntry);
}

export async function publishedEntries(kind: EntryKind): Promise<CmsEntry[]> {
  return fetchRecords(`kind = "${kind}" && status = "published"`, "-publishedAt");
}

export async function publishedEntry(kind: EntryKind, slug: string): Promise<CmsEntry | null> {
  const safeSlug = slug.replace(/["\\]/g, "");
  const found = await fetchRecords(`kind = "${kind}" && status = "published" && slug = "${safeSlug}"`, "-publishedAt");
  return found[0] ?? null;
}

export async function allEntries(): Promise<CmsEntry[]> {
  return fetchRecords("", "-created");
}

export async function entryById(id: string): Promise<CmsEntry | null> {
  const response = await asAdmin("GET", `/api/collections/entries/records/${encodeURIComponent(id)}`);
  if (response.status === 404 || response.status === 400) return null;
  if (response.status !== 200) throw errors.cmsUnavailable();
  return toEntry(response.body as CmsRecord);
}

export async function entryBySlug(slug: string): Promise<CmsEntry | null> {
  const safeSlug = slug.replace(/["\\]/g, "");
  const found = await fetchRecords(`slug = "${safeSlug}"`, "-created");
  return found[0] ?? null;
}

export async function createEntry(input: {
  kind: EntryKind;
  slug: string;
  title: string;
  client: string;
  year: number;
  summary: string;
  body: string;
  status?: EntryStatus;
  publishedAt?: string | null;
}): Promise<CmsEntry> {
  const response = await asAdmin("POST", "/api/collections/entries/records", {
    kind: input.kind,
    slug: input.slug,
    title: input.title,
    client: input.client,
    year: input.year,
    summary: input.summary,
    body: input.body,
    status: input.status ?? "draft",
    publishedAt: input.publishedAt ?? "",
  });
  if (response.status !== 200) throw errors.cmsUnavailable();
  return toEntry(response.body as CmsRecord);
}

export async function setEntryStatus(
  id: string,
  status: EntryStatus,
  publishedAt: string | null,
): Promise<CmsEntry> {
  const response = await asAdmin("PATCH", `/api/collections/entries/records/${encodeURIComponent(id)}`, {
    status,
    publishedAt: publishedAt ?? "",
  });
  if (response.status !== 200) throw errors.cmsUnavailable();
  return toEntry(response.body as CmsRecord);
}
