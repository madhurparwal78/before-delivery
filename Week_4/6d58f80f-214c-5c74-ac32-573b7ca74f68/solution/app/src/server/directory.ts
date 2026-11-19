// PocketBase: the people directory and sign-in (brief: Services). The app talks to the `users` auth collection with
// the admin account from the environment.
import { config } from "./config.js";
import type { Person, PersonKind, StaffRole } from "../shared/api.js";

/** The directory could not be reached. */
export class DirectoryUnavailable extends Error {}

const TIMEOUT_MS = 8_000;
let adminToken: string | null = null;

async function send(path: string, init: RequestInit = {}, token?: string): Promise<Response> {
  try {
    return await fetch(`${config.directory.url}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...(token ? { authorization: token } : {}), ...init.headers },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new DirectoryUnavailable("directory unreachable");
  }
}

async function signInAdmin(): Promise<string> {
  const response = await send("/api/admins/auth-with-password", {
    method: "POST",
    body: JSON.stringify({ identity: config.directory.adminEmail, password: config.directory.adminPassword }),
  });
  if (!response.ok) throw new DirectoryUnavailable(`directory admin sign-in answered ${response.status}`);
  const body = (await response.json()) as { token: string };
  return body.token;
}

async function admin(path: string, init: RequestInit = {}): Promise<Response> {
  adminToken ??= await signInAdmin();
  let response = await send(path, init, adminToken);
  if (response.status === 401 || response.status === 403) {
    adminToken = await signInAdmin();
    response = await send(path, init, adminToken);
  }
  if (response.status >= 500) throw new DirectoryUnavailable(`directory answered ${response.status}`);
  return response;
}

interface UserRecord {
  id: string;
  email: string;
  name: string;
  firm: string;
  kind: string;
  staffRole: string;
}

function toPerson(record: UserRecord): Person | null {
  if (record.kind !== "staff" && record.kind !== "partner") return null;
  const role = ["engineer", "controller", "admin"].includes(record.staffRole) ? (record.staffRole as StaffRole) : null;
  return {
    id: record.id,
    name: record.name,
    email: record.email,
    firm: record.firm,
    kind: record.kind,
    staffRole: record.kind === "staff" ? role : null,
  };
}

function literal(text: string): string {
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export async function ping(): Promise<boolean> {
  try {
    const response = await send("/api/health");
    await response.body?.cancel();
    return response.ok;
  } catch {
    return false;
  }
}

interface SchemaField {
  name: string;
  type: string;
  required?: boolean;
  options?: Record<string, unknown>;
}

const FIELDS: SchemaField[] = [
  { name: "name", type: "text", options: { min: null, max: null, pattern: "" } },
  { name: "firm", type: "text", options: { min: null, max: null, pattern: "" } },
  { name: "kind", type: "select", options: { maxSelect: 1, values: ["staff", "partner"] } },
  { name: "staffRole", type: "select", options: { maxSelect: 1, values: ["engineer", "controller", "admin"] } },
  { name: "avatar", type: "file", options: { maxSelect: 1, maxSize: 5_242_880, mimeTypes: ["image/png", "image/jpeg"], thumbs: [], protected: false } },
];

/** Adds the directory fields the app needs to `users`, leaving any that already exist alone. */
export async function ensureFields(): Promise<void> {
  const response = await admin("/api/collections/users");
  if (!response.ok) throw new DirectoryUnavailable(`users collection answered ${response.status}`);
  const collection = (await response.json()) as { schema: SchemaField[] };
  const missing = FIELDS.filter((field) => !collection.schema.some((existing) => existing.name === field.name));
  if (!missing.length) return;
  const patch = await admin("/api/collections/users", {
    method: "PATCH",
    body: JSON.stringify({ schema: [...collection.schema, ...missing] }),
  });
  if (!patch.ok) throw new Error(`adding directory fields answered ${patch.status}: ${await patch.text()}`);
}

export interface SeedPerson {
  name: string;
  email: string;
  kind: PersonKind;
  firm: string;
  staffRole: StaffRole | null;
}

/** Creates or updates a directory person by email and returns them. */
export async function upsertPerson(person: SeedPerson, password: string): Promise<Person> {
  const found = await admin(`/api/collections/users/records?perPage=1&filter=${encodeURIComponent(`email = ${literal(person.email)}`)}`);
  if (!found.ok) throw new Error(`directory lookup answered ${found.status}`);
  const existing = ((await found.json()) as { items: UserRecord[] }).items[0];
  const fields = {
    name: person.name, firm: person.firm, kind: person.kind, staffRole: person.staffRole ?? "",
    password, passwordConfirm: password, verified: true, emailVisibility: true,
  };
  const response = existing
    ? await admin(`/api/collections/users/records/${existing.id}`, { method: "PATCH", body: JSON.stringify(fields) })
    : await admin("/api/collections/users/records", { method: "POST", body: JSON.stringify({ ...fields, email: person.email }) });
  if (!response.ok) throw new Error(`saving ${person.email} in the directory answered ${response.status}: ${await response.text()}`);
  const saved = toPerson((await response.json()) as UserRecord);
  if (!saved) throw new Error(`directory record for ${person.email} has no kind`);
  return saved;
}

/** Checks email and password against the directory; null when they do not match. */
export async function authenticate(email: string, password: string): Promise<Person | null> {
  const response = await send("/api/collections/users/auth-with-password", {
    method: "POST",
    body: JSON.stringify({ identity: email, password }),
  });
  if (response.status >= 500) throw new DirectoryUnavailable(`directory answered ${response.status}`);
  if (!response.ok) return null;
  const body = (await response.json()) as { record: UserRecord };
  return toPerson(body.record);
}

export async function findPerson(id: string): Promise<Person | null> {
  const response = await admin(`/api/collections/users/records/${encodeURIComponent(id)}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new DirectoryUnavailable(`directory answered ${response.status}`);
  return toPerson((await response.json()) as UserRecord);
}

export async function searchPeople(q: string, kind: PersonKind | null): Promise<Person[]> {
  const text = literal(q);
  const filter = `(name ~ ${text} || firm ~ ${text} || email ~ ${text})${kind ? ` && kind = ${literal(kind)}` : ""}`;
  const response = await admin(`/api/collections/users/records?perPage=20&sort=name&filter=${encodeURIComponent(filter)}`);
  if (!response.ok) throw new DirectoryUnavailable(`directory search answered ${response.status}`);
  const items = ((await response.json()) as { items: UserRecord[] }).items;
  return items.map(toPerson).filter((p): p is Person => p !== null);
}
