// PocketBase REST client (admin auth). Only the server talks to PocketBase; browsers never do.
import { config, PROVIDER_TIMEOUT_MS } from "./config.js";
import { ProviderUnavailable } from "./errors.js";

export interface PbRecord {
  id: string;
  created: string;
  [field: string]: unknown;
}

type FieldType = "text" | "number";

/** The collections the app creates on every start and after reconnecting, leaving existing ones alone. */
export const COLLECTIONS: Record<string, Record<string, FieldType>> = {
  lf_presence: { project_id: "text", user_id: "text", name: "text", seen_at: "number" },
  lf_comments: { project_id: "text", author_id: "text", author_name: "text", body: "text" },
  lf_placements: {
    project_id: "text",
    placement_id: "text",
    variant_code: "text",
    x_mm: "number",
    y_mm: "number",
    action: "text",
  },
};

let token: string | null = null;

async function raw(method: string, path: string, body: unknown, timeoutMs: number, auth: boolean): Promise<Response> {
  try {
    return await fetch(`${config.pocketbase.url}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(auth && token ? { Authorization: token } : {}),
      },
      body: body === undefined ? null : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new ProviderUnavailable("pocketbase", `${method} ${path.split("?")[0]} got no reply`);
  }
}

async function authenticate(timeoutMs = PROVIDER_TIMEOUT_MS): Promise<string> {
  const response = await raw(
    "POST",
    "/api/admins/auth-with-password",
    { identity: config.pocketbase.email, password: config.pocketbase.password },
    timeoutMs,
    false,
  );
  if (!response.ok) throw new ProviderUnavailable("pocketbase", `admin auth answered ${response.status}`);
  token = ((await response.json()) as { token: string }).token;
  return token;
}

async function call(method: string, path: string, body?: unknown, timeoutMs = PROVIDER_TIMEOUT_MS): Promise<Response> {
  if (!token) await authenticate(timeoutMs);
  let response = await raw(method, path, body, timeoutMs, true);
  if (response.status === 401 || response.status === 403) {
    await authenticate(timeoutMs);
    response = await raw(method, path, body, timeoutMs, true);
  }
  return response;
}

async function ok<T>(response: Response, what: string): Promise<T> {
  if (!response.ok) throw new ProviderUnavailable("pocketbase", `${what} answered ${response.status}`);
  return (response.status === 204 ? undefined : await response.json()) as T;
}

export async function ensureCollections(): Promise<void> {
  const existing = await ok<{ items: { name: string }[] }>(
    await call("GET", "/api/collections?perPage=500&fields=name"),
    "collection list",
  );
  const names = new Set(existing.items.map((item) => item.name));
  for (const [name, fields] of Object.entries(COLLECTIONS)) {
    if (names.has(name)) continue;
    const created = await call("POST", "/api/collections", {
      name,
      type: "base",
      schema: Object.entries(fields).map(([field, type]) => ({ name: field, type, options: {} })),
    });
    // Another instance may have created it a moment ago; that is the state we want.
    if (!created.ok && created.status !== 400) await ok(created, `create ${name}`);
  }
}

export function quote(value: string): string {
  return `"${value.replace(/["\\]/g, "")}"`;
}

export async function createRecord(collection: string, data: Record<string, unknown>): Promise<PbRecord> {
  return ok<PbRecord>(await call("POST", `/api/collections/${collection}/records`, data), `create ${collection}`);
}

export async function updateRecord(collection: string, id: string, data: Record<string, unknown>): Promise<PbRecord> {
  return ok<PbRecord>(await call("PATCH", `/api/collections/${collection}/records/${id}`, data), `update ${collection}`);
}

export async function deleteRecord(collection: string, id: string): Promise<void> {
  const response = await call("DELETE", `/api/collections/${collection}/records/${id}`);
  if (response.status !== 404) await ok(response, `delete ${collection}`);
}

export async function listRecords(collection: string, filter: string, sort = "created"): Promise<PbRecord[]> {
  const query = new URLSearchParams({ perPage: "500", filter, sort });
  const page = await ok<{ items: PbRecord[] }>(
    await call("GET", `/api/collections/${collection}/records?${query}`),
    `list ${collection}`,
  );
  return page.items;
}

/** Sets the realtime client's subscriptions; the request carries the admin token so admin rules apply. */
export async function subscribe(clientId: string, subscriptions: string[]): Promise<void> {
  await ok(await call("POST", "/api/realtime", { clientId, subscriptions }), "realtime subscribe");
}

/** "2026-11-01 03:22:20.123Z" → ISO 8601. */
export function isoTime(value: string): string {
  return new Date(value.replace(" ", "T")).toISOString();
}

export async function healthy(timeoutMs: number): Promise<boolean> {
  try {
    return (await raw("GET", "/api/health", undefined, timeoutMs, false)).ok;
  } catch {
    return false;
  }
}
