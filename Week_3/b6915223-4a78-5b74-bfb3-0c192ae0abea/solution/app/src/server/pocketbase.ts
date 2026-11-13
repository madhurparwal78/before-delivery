import type { Notice, NoticeKind } from "../shared/api.ts";
import { config } from "./config.ts";
import { OPERATOR } from "./seed.ts";

// PocketBase holds the accounts (`users`) and the notice inbox (`notices`) (brief: Services / PocketBase).
export class PocketBaseUnreachable extends Error {}

interface Reply {
  status: number;
  data: Record<string, unknown>;
}

let adminToken: string | null = null;

async function call(method: string, path: string, body?: unknown, token?: string): Promise<Reply> {
  let response: Response;
  try {
    response = await fetch(config.pocketbase.url + path, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: token } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw new PocketBaseUnreachable("PocketBase is unreachable");
  }
  const text = await response.text();
  return { status: response.status, data: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

async function asAdmin(method: string, path: string, body?: unknown): Promise<Reply> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (!adminToken) {
      const auth = await call("POST", "/api/admins/auth-with-password", {
        identity: config.pocketbase.adminEmail,
        password: config.pocketbase.adminPassword,
      });
      if (auth.status !== 200) throw new Error(`PocketBase admin sign-in answered ${auth.status}`);
      adminToken = String(auth.data.token);
    }
    const reply = await call(method, path, body, adminToken);
    if (reply.status !== 401 && reply.status !== 403) return reply;
    adminToken = null;
  }
  throw new Error(`PocketBase refused the admin token for ${path}`);
}

const quoted = (value: string) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

async function findUserId(email: string): Promise<string | null> {
  const reply = await asAdmin("GET", `/api/collections/users/records?perPage=1&filter=${encodeURIComponent(`email=${quoted(email)}`)}`);
  const items = reply.data.items as { id: string }[] | undefined;
  return items?.[0]?.id ?? null;
}

// Creates the notices collection and the operator account when they are missing. Safe to repeat.
export async function ensurePocketBase(): Promise<void> {
  const existing = await asAdmin("GET", "/api/collections/notices");
  if (existing.status === 404) {
    const created = await asAdmin("POST", "/api/collections", {
      name: "notices",
      type: "base",
      schema: [
        { name: "manager", type: "text", required: true },
        {
          name: "kind",
          type: "select",
          required: true,
          options: { maxSelect: 1, values: ["deadline_locked", "transfer_refused", "auto_sub", "price_change"] },
        },
        { name: "gameweek", type: "number", required: false },
        { name: "message", type: "text", required: true },
        { name: "read", type: "bool", required: false },
      ],
      indexes: ["CREATE INDEX idx_notices_manager ON notices (manager)"],
    });
    if (created.status !== 200 && (await asAdmin("GET", "/api/collections/notices")).status !== 200) {
      throw new Error(`PocketBase could not create notices (${created.status})`);
    }
  }
  if (!(await findUserId(OPERATOR.email))) {
    await createUser(OPERATOR.email, OPERATOR.password, OPERATOR.teamName);
  }
}

type CreatedUser = { id: string } | { taken: true };

export async function createUser(email: string, password: string, teamName: string): Promise<CreatedUser> {
  if (await findUserId(email)) return { taken: true };
  const reply = await asAdmin("POST", "/api/collections/users/records", {
    email,
    password,
    passwordConfirm: password,
    name: teamName,
    emailVisibility: false,
    verified: true,
  });
  if (reply.status === 200) return { id: String(reply.data.id) };
  // Another request may have created the same account a moment earlier.
  if (reply.status === 400 && (await findUserId(email))) return { taken: true };
  throw new Error(`PocketBase could not create the account (${reply.status}): ${JSON.stringify(reply.data.data ?? {})}`);
}

export async function signInUser(email: string, password: string): Promise<{ id: string; name: string } | null> {
  const reply = await call("POST", "/api/collections/users/auth-with-password", { identity: email, password });
  if (reply.status !== 200) return null;
  const record = reply.data.record as { id: string; name?: string };
  return { id: record.id, name: record.name ?? "" };
}

export async function storeNotice(id: string, notice: { manager: string; kind: NoticeKind; gameweek: number; message: string }): Promise<void> {
  const reply = await asAdmin("POST", "/api/collections/notices/records", { id, ...notice, read: false });
  if (reply.status === 200) return;
  // The record id is derived from the outbox row, so a repeat after a lost reply finds the first copy.
  if ((await asAdmin("GET", `/api/collections/notices/records/${id}`)).status === 200) return;
  throw new Error(`PocketBase could not store notice ${id} (${reply.status})`);
}

interface NoticeRecord {
  id: string;
  kind: Notice["kind"];
  gameweek: number;
  message: string;
  read: boolean;
  created: string;
}

async function noticeRecords(manager: string, extraFilter = ""): Promise<NoticeRecord[]> {
  const filter = encodeURIComponent(`manager=${quoted(manager)}${extraFilter}`);
  const reply = await asAdmin("GET", `/api/collections/notices/records?perPage=200&sort=-created,-id&filter=${filter}`);
  if (reply.status !== 200) throw new Error(`PocketBase notices answered ${reply.status}`);
  return reply.data.items as NoticeRecord[];
}

export async function listNotices(manager: string): Promise<Notice[]> {
  return (await noticeRecords(manager)).map((record) => ({
    id: record.id,
    kind: record.kind,
    gameweek: record.gameweek,
    message: record.message,
    read: record.read,
    created: new Date(record.created.replace(" ", "T")).toISOString(),
  }));
}

export async function markAllRead(manager: string): Promise<void> {
  for (const record of await noticeRecords(manager, " && read=false")) {
    await asAdmin("PATCH", `/api/collections/notices/records/${record.id}`, { read: true });
  }
}
