/**
 * PocketBase carries live collaboration: presence, comments and placement
 * changes. Browsers never contact PocketBase; the server subscribes to its
 * changes and relays them to browsers through the project live stream.
 *
 * Nothing records that PocketBase is down. Every call tries it afresh, and the
 * first call that succeeds counts as its return.
 */

import { loadConfig, PROVIDER_TIMEOUT_MS } from "../config.js";
import {
  expectOk,
  parseJson,
  providerFetch,
  ProviderUnavailable,
  type ProviderResponse,
} from "./provider.js";

const config = loadConfig();

export const COLLECTIONS = {
  presence: "lf_presence",
  comments: "lf_comments",
  placements: "lf_placements",
} as const;

/** This PocketBase build uses the legacy admin login and the `schema` field style. */
const COLLECTION_SCHEMAS: ReadonlyArray<{ name: string; schema: ReadonlyArray<Record<string, unknown>> }> = [
  {
    name: COLLECTIONS.presence,
    schema: [
      { name: "project_id", type: "text", required: true },
      { name: "user_id", type: "text", required: true },
      { name: "name", type: "text", required: true },
      { name: "seen_at", type: "text", required: false },
    ],
  },
  {
    name: COLLECTIONS.comments,
    schema: [
      { name: "project_id", type: "text", required: true },
      { name: "author_id", type: "text", required: true },
      { name: "author_name", type: "text", required: true },
      { name: "body", type: "text", required: true },
    ],
  },
  {
    name: COLLECTIONS.placements,
    schema: [
      { name: "project_id", type: "text", required: true },
      { name: "placement_id", type: "text", required: true },
      { name: "variant_code", type: "text", required: false },
      { name: "x_mm", type: "number", required: false },
      { name: "y_mm", type: "number", required: false },
      { name: "action", type: "text", required: false },
    ],
  },
];

let adminToken: string | null = null;

async function login(): Promise<string> {
  const response = await providerFetch("pocketbase", `${config.pocketbase.url}/api/admins/auth-with-password`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      identity: config.pocketbase.adminEmail,
      password: config.pocketbase.adminPassword,
    }),
  });
  expectOk("pocketbase", response, [200]);
  const body = parseJson<{ token?: string }>("pocketbase", response);
  if (!body.token) throw new ProviderUnavailable("pocketbase", new Error("PocketBase returned no admin token"));
  adminToken = body.token;
  return body.token;
}

/** Calls PocketBase as the admin, logging in again if the cached token has expired. */
async function authorised(
  path: string,
  init: RequestInit & { timeoutMs?: number } = {},
  allowed: readonly number[] = [200, 201, 204],
): Promise<string> {
  const attempt = async (token: string): Promise<ProviderResponse> => {
    const headers: Record<string, string> = { authorization: token };
    if (init.body !== undefined) headers["content-type"] = "application/json";
    return providerFetch("pocketbase", `${config.pocketbase.url}${path}`, { ...init, headers });
  };

  let response = await attempt(adminToken ?? (await login()));
  if (response.status === 401 || response.status === 403) response = await attempt(await login());
  expectOk("pocketbase", response, allowed);
  return response.text;
}

interface PbListResponse<T> {
  items: T[];
}

/**
 * Creates the collections the app needs, leaving existing ones as they are. Run
 * on every start and again after reconnecting.
 */
export async function ensureCollections(): Promise<void> {
  const listed = await authorised("/api/collections?perPage=200", { method: "GET" }, [200]);
  const existing = new Set(
    (JSON.parse(listed) as PbListResponse<{ name: string }>).items.map((collection) => collection.name),
  );

  for (const definition of COLLECTION_SCHEMAS) {
    if (existing.has(definition.name)) continue;
    await authorised(
      "/api/collections",
      {
        method: "POST",
        body: JSON.stringify({ name: definition.name, type: "base", schema: definition.schema }),
      },
      [200, 201, 400],
    );
  }
}

export interface PresenceRecord {
  id: string;
  project_id: string;
  user_id: string;
  name: string;
  seen_at: string;
}

export interface CommentRecord {
  id: string;
  project_id: string;
  author_id: string;
  author_name: string;
  body: string;
  created: string;
}

function filterParam(filter: string): string {
  return `filter=${encodeURIComponent(filter)}`;
}

/** One presence record per viewer per project, refreshed while the project is open. */
export async function touchPresence(args: {
  projectId: string;
  userId: string;
  name: string;
}): Promise<void> {
  const seenAt = new Date().toISOString();
  const found = await authorised(
    `/api/collections/${COLLECTIONS.presence}/records?perPage=1&` +
      filterParam(`project_id="${args.projectId}" && user_id="${args.userId}"`),
    { method: "GET" },
    [200],
  );
  const existing = (JSON.parse(found) as PbListResponse<PresenceRecord>).items[0];
  const payload = JSON.stringify({
    project_id: args.projectId,
    user_id: args.userId,
    name: args.name,
    seen_at: seenAt,
  });

  if (existing) {
    await authorised(`/api/collections/${COLLECTIONS.presence}/records/${existing.id}`, {
      method: "PATCH",
      body: payload,
    });
  } else {
    await authorised(`/api/collections/${COLLECTIONS.presence}/records`, { method: "POST", body: payload });
  }
}

export async function dropPresence(args: { projectId: string; userId: string }): Promise<void> {
  const found = await authorised(
    `/api/collections/${COLLECTIONS.presence}/records?perPage=1&` +
      filterParam(`project_id="${args.projectId}" && user_id="${args.userId}"`),
    { method: "GET" },
    [200],
  );
  const existing = (JSON.parse(found) as PbListResponse<PresenceRecord>).items[0];
  if (existing) {
    await authorised(`/api/collections/${COLLECTIONS.presence}/records/${existing.id}`, { method: "DELETE" }, [
      200,
      204,
      404,
    ]);
  }
}

/** A viewer leaves "Viewing now" within 30 seconds of closing the project. */
const PRESENCE_TTL_MS = 30_000;

export async function listPresence(projectId: string): Promise<PresenceRecord[]> {
  const found = await authorised(
    `/api/collections/${COLLECTIONS.presence}/records?perPage=200&` +
      filterParam(`project_id="${projectId}"`),
    { method: "GET" },
    [200],
  );
  const cutoff = Date.now() - PRESENCE_TTL_MS;
  return (JSON.parse(found) as PbListResponse<PresenceRecord>).items.filter((record) => {
    const seen = Date.parse(record.seen_at);
    return Number.isFinite(seen) ? seen >= cutoff : true;
  });
}

export async function listComments(projectId: string): Promise<CommentRecord[]> {
  const found = await authorised(
    `/api/collections/${COLLECTIONS.comments}/records?perPage=500&sort=created&` +
      filterParam(`project_id="${projectId}"`),
    { method: "GET" },
    [200],
  );
  return (JSON.parse(found) as PbListResponse<CommentRecord>).items;
}

export async function createComment(args: {
  projectId: string;
  authorId: string;
  authorName: string;
  body: string;
}): Promise<CommentRecord> {
  const created = await authorised(
    `/api/collections/${COLLECTIONS.comments}/records`,
    {
      method: "POST",
      body: JSON.stringify({
        project_id: args.projectId,
        author_id: args.authorId,
        author_name: args.authorName,
        body: args.body,
      }),
    },
    [200, 201],
  );
  return JSON.parse(created) as CommentRecord;
}

/** Placement changes are written here after the Postgres save. */
export async function recordPlacementChange(args: {
  projectId: string;
  placementId: string;
  variantCode: string;
  xMm: number;
  yMm: number;
  action: "created" | "updated" | "deleted";
}): Promise<void> {
  await authorised(
    `/api/collections/${COLLECTIONS.placements}/records`,
    {
      method: "POST",
      body: JSON.stringify({
        project_id: args.projectId,
        placement_id: args.placementId,
        variant_code: args.variantCode,
        x_mm: args.xMm,
        y_mm: args.yMm,
        action: args.action,
      }),
    },
    [200, 201],
  );
}

export async function ping(timeoutMs: number): Promise<void> {
  const response = await providerFetch("pocketbase", `${config.pocketbase.url}/api/health`, { timeoutMs });
  expectOk("pocketbase", response, [200]);
}

/** Used by the live stream to tell browsers whether collaboration is connected. */
export async function isReachable(): Promise<boolean> {
  try {
    await ping(PROVIDER_TIMEOUT_MS);
    return true;
  } catch {
    return false;
  }
}
