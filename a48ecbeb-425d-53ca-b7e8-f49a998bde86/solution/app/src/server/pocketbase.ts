import { createHash } from "node:crypto";
import { config } from "./config.js";
import { accountsUnavailable } from "./http.js";

// PocketBase holds accounts, saved addresses and reviews, and is the realtime feed for stock-left
// counts and approved reviews. The server talks to it as an admin; browsers never do.

const BASE = config.pocketbase.url;
let adminToken: string | null = null;

export class PocketBaseError extends Error {
  constructor(
    readonly status: number,
    readonly data: Record<string, { code?: string }>,
  ) {
    super(`PocketBase answered ${status}`);
  }
}

async function authenticate(): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`${BASE}/api/admins/auth-with-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identity: config.pocketbase.email, password: config.pocketbase.password }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw accountsUnavailable();
  }
  if (response.status !== 200) throw accountsUnavailable();
  adminToken = ((await response.json()) as { token: string }).token;
  return adminToken;
}

interface PbAnswer {
  status: number;
  body: Record<string, unknown>;
}

async function raw(method: string, path: string, body?: unknown, retry = true): Promise<PbAnswer> {
  const token = adminToken ?? (await authenticate());
  let response: Response;
  try {
    response = await fetch(BASE + path, {
      method,
      headers: { Authorization: token, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw accountsUnavailable();
  }
  if (response.status === 401 && retry) {
    adminToken = null;
    return raw(method, path, body, false);
  }
  if (response.status >= 500) throw accountsUnavailable();
  const text = await response.text();
  return { status: response.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

async function pb<T>(method: string, path: string, body?: unknown): Promise<T> {
  const answer = await raw(method, path, body);
  if (answer.status >= 300) {
    throw new PocketBaseError(answer.status, (answer.body.data ?? {}) as Record<string, { code?: string }>);
  }
  return answer.body as T;
}

export async function probePocketBase(): Promise<boolean> {
  try {
    const response = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(2500) });
    return response.status === 200;
  } catch {
    return false;
  }
}

/** A PocketBase filter string literal. */
export const literal = (value: string): string => `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

interface List<T> {
  items: T[];
}

async function list<T>(collection: string, filter: string, sort = ""): Promise<T[]> {
  const params = new URLSearchParams({ perPage: "500", filter, ...(sort ? { sort } : {}) });
  return (await pb<List<T>>("GET", `/api/collections/${collection}/records?${params}`)).items;
}

// ---- collections --------------------------------------------------------------------------

type Field = { name: string; type: string; required?: boolean; options?: Record<string, unknown> };
const text = (name: string, required = true): Field => ({ name, type: "text", required, options: {} });
const number = (name: string): Field => ({ name, type: "number", required: false, options: {} });
const flag = (name: string): Field => ({ name, type: "bool", required: false, options: {} });

const COLLECTIONS: { name: string; schema: Field[]; indexes: string[] }[] = [
  {
    name: "addresses",
    schema: [text("user"), text("name"), text("line1"), text("line2", false), text("city"), text("province"), text("postal_code"), flag("is_default")],
    indexes: ["CREATE INDEX idx_addresses_user ON addresses (user)"],
  },
  {
    name: "reviews",
    schema: [text("scope"), text("flavour"), text("user"), text("author_first_name"), number("rating"), text("body"), text("status")],
    indexes: ["CREATE INDEX idx_reviews_scope ON reviews (scope, flavour)"],
  },
  {
    name: "stock_levels",
    schema: [text("scope"), text("flavour"), number("stock_left")],
    indexes: ["CREATE UNIQUE INDEX idx_stock_scope_flavour ON stock_levels (scope, flavour)"],
  },
];

interface CollectionJson {
  name: string;
  schema: (Field & { id?: string })[];
}

/** Creates the missing collections and the `role` field on users; admin-only rules everywhere. */
export async function ensureCollections(): Promise<void> {
  const users = await pb<CollectionJson>("GET", "/api/collections/users");
  if (!users.schema.some((f) => f.name === "role")) {
    await pb("PATCH", "/api/collections/users", {
      schema: [...users.schema, text("role")],
      createRule: null,
      updateRule: null,
      deleteRule: null,
    });
  }
  for (const collection of COLLECTIONS) {
    const found = await raw("GET", `/api/collections/${collection.name}`);
    if (found.status === 200) continue;
    const created = await raw("POST", "/api/collections", {
      name: collection.name,
      type: "base",
      schema: collection.schema,
      indexes: collection.indexes,
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
    });
    if (created.status >= 300 && (await raw("GET", `/api/collections/${collection.name}`)).status !== 200) {
      throw new PocketBaseError(created.status, {});
    }
  }
}

// ---- users --------------------------------------------------------------------------------

export type Role = "customer" | "fulfilment" | "support" | "owner";

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
}

interface UserRecord {
  id: string;
  email: string;
  name: string;
  role: Role;
}

/**
 * PocketBase caps passwords at 72 bytes (bcrypt); the brief allows 128 characters, so the
 * server hands PocketBase a fixed-length digest of the password instead.
 */
const secret = (password: string): string => createHash("sha256").update(`ceibo:${password}`).digest("hex");

const toUser = (r: UserRecord): User => ({ id: r.id, email: r.email, name: r.name, role: r.role });

async function findUserByEmail(email: string): Promise<User | undefined> {
  const [found] = await list<UserRecord>("users", `email=${literal(email)}`);
  return found ? toUser(found) : undefined;
}

export async function createUser(email: string, password: string, name: string, role: Role): Promise<User> {
  const record = await pb<UserRecord>("POST", "/api/collections/users/records", {
    email,
    emailVisibility: true,
    verified: true,
    password: secret(password),
    passwordConfirm: secret(password),
    name,
    role,
  });
  return toUser(record);
}

/** Returns the user for a matching email and password, or undefined for a mismatch. */
export async function checkPassword(email: string, password: string): Promise<User | undefined> {
  let response: Response;
  try {
    response = await fetch(`${BASE}/api/collections/users/auth-with-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identity: email, password: secret(password) }),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw accountsUnavailable();
  }
  if (response.status >= 500) throw accountsUnavailable();
  if (response.status !== 200) return undefined;
  return toUser(((await response.json()) as { record: UserRecord }).record);
}

// ---- addresses ----------------------------------------------------------------------------

export type Address = {
  id: string;
  name: string;
  line1: string;
  line2: string;
  city: string;
  province: string;
  postal_code: string;
  is_default: boolean;
};

interface AddressRecord extends Address {
  user: string;
  created: string;
}

const toAddress = (r: AddressRecord): Address => ({
  id: r.id,
  name: r.name,
  line1: r.line1,
  line2: r.line2,
  city: r.city,
  province: r.province,
  postal_code: r.postal_code,
  is_default: r.is_default,
});

export async function addresses(userId: string): Promise<Address[]> {
  return (await list<AddressRecord>("addresses", `user=${literal(userId)}`, "created")).map(toAddress);
}

export async function address(userId: string, id: string): Promise<Address | undefined> {
  return (await addresses(userId)).find((a) => a.id === id);
}

/** Saves an address and keeps exactly one default per account. */
export async function saveAddress(userId: string, fields: Omit<Address, "id">, id?: string): Promise<Address> {
  const existing = await addresses(userId);
  const makeDefault = fields.is_default || existing.filter((a) => a.id !== id).length === 0;
  const record = id
    ? await pb<AddressRecord>("PATCH", `/api/collections/addresses/records/${id}`, { ...fields, is_default: makeDefault })
    : await pb<AddressRecord>("POST", "/api/collections/addresses/records", { ...fields, user: userId, is_default: makeDefault });
  if (makeDefault) {
    for (const other of existing) {
      if (other.id !== record.id && other.is_default) {
        await pb("PATCH", `/api/collections/addresses/records/${other.id}`, { is_default: false });
      }
    }
  }
  return toAddress(record);
}

// ---- reviews ------------------------------------------------------------------------------

export interface Review {
  id: string;
  flavour: string;
  user: string;
  author_first_name: string;
  rating: number;
  body: string;
  status: "pending" | "approved" | "rejected";
  created: string;
}

export async function reviews(filter: string, sort = "-created"): Promise<Review[]> {
  return list<Review>("reviews", `scope=${literal(config.database)} && ${filter}`, sort);
}

export async function createReview(fields: Omit<Review, "id" | "created" | "status">): Promise<Review> {
  return pb<Review>("POST", "/api/collections/reviews/records", { ...fields, scope: config.database, status: "pending" });
}

export async function decideReview(id: string, status: "approved" | "rejected"): Promise<Review> {
  return pb<Review>("PATCH", `/api/collections/reviews/records/${id}`, { status });
}

// ---- stock levels -------------------------------------------------------------------------

const stockRecordIds = new Map<string, string>();

/** Mirrors a flavour's stock-left count into PocketBase for this process's scope. */
export async function publishStockLevel(flavour: string, stockLeft: number): Promise<void> {
  let id = stockRecordIds.get(flavour);
  if (id === undefined) {
    const [found] = await list<{ id: string }>("stock_levels", `scope=${literal(config.database)} && flavour=${literal(flavour)}`);
    if (found) {
      id = found.id;
    } else {
      const created = await raw("POST", "/api/collections/stock_levels/records", {
        scope: config.database,
        flavour,
        stock_left: stockLeft,
      });
      if (created.status < 300) {
        stockRecordIds.set(flavour, String(created.body.id));
        return;
      }
      const [again] = await list<{ id: string }>("stock_levels", `scope=${literal(config.database)} && flavour=${literal(flavour)}`);
      id = again.id;
    }
    stockRecordIds.set(flavour, id);
  }
  const updated = await raw("PATCH", `/api/collections/stock_levels/records/${id}`, { stock_left: stockLeft });
  if (updated.status === 404) {
    stockRecordIds.delete(flavour);
    await publishStockLevel(flavour, stockLeft);
  }
}

// ---- realtime -----------------------------------------------------------------------------

export interface RealtimeEvent {
  collection: "stock_levels" | "reviews";
  action: string;
  record: Record<string, unknown>;
}

let realtimeConnected = false;
export const realtimeUp = (): boolean => realtimeConnected;

/** Holds one realtime connection to PocketBase, reconnecting while it is unreachable. */
export async function followRealtime(onEvent: (event: RealtimeEvent) => void): Promise<void> {
  for (;;) {
    try {
      const response = await fetch(`${BASE}/api/realtime`, { headers: { Accept: "text/event-stream" } });
      if (!response.body) throw new Error("no realtime body");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let end: number;
        while ((end = buffer.indexOf("\n\n")) !== -1) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const name = /^event:(.*)$/m.exec(block)?.[1]?.trim();
          const data = block
            .split("\n")
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5))
            .join("\n");
          if (!name || !data) continue;
          const payload = JSON.parse(data) as Record<string, unknown>;
          if (name === "PB_CONNECT") {
            await pb("POST", "/api/realtime", {
              clientId: payload.clientId,
              subscriptions: ["stock_levels", "reviews"],
            });
            realtimeConnected = true;
          } else if (name === "stock_levels" || name === "reviews") {
            onEvent({
              collection: name,
              action: String(payload.action),
              record: payload.record as Record<string, unknown>,
            });
          }
        }
      }
    } catch {
      // PocketBase went away; the live feed pauses until it returns.
    }
    realtimeConnected = false;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

export async function seedAccounts(): Promise<void> {
  const seeds: [string, string, string, Role, Omit<Address, "id"> | null][] = [
    ["owner@ceibo.test", "Ceibo-owner-2026", "Marisol Ferreyra", "owner", null],
    ["pack@ceibo.test", "Ceibo-pack-2026", "Tomas Leclerc", "fulfilment", null],
    ["help@ceibo.test", "Ceibo-help-2026", "Priya Anand", "support", null],
    [
      "camille@example.test",
      "Shopper-2026-qc",
      "Camille Roy",
      "customer",
      { name: "Camille Roy", line1: "48 rue des Ceibos", line2: "", city: "Montreal", province: "QC", postal_code: "H2X 1Y4", is_default: true },
    ],
    [
      "jordan@example.test",
      "Shopper-2026-on",
      "Jordan Mensah",
      "customer",
      { name: "Jordan Mensah", line1: "77 Canopy Lane", line2: "", city: "Toronto", province: "ON", postal_code: "M5V 2T6", is_default: true },
    ],
  ];
  for (const [email, password, name, role, home] of seeds) {
    let user = await findUserByEmail(email);
    if (!user) {
      try {
        user = await createUser(email, password, name, role);
      } catch (error) {
        if (!(error instanceof PocketBaseError)) throw error;
        user = await findUserByEmail(email);
        if (!user) throw error;
      }
    }
    if (home && (await addresses(user.id)).length === 0) await saveAddress(user.id, home);
  }
}
