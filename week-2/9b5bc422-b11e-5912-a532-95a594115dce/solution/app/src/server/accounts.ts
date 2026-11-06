import { randomBytes, randomUUID, scrypt, createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { promisify } from "node:util";
import { db, requireDatabase, transaction } from "./db.ts";
import type { Queryable } from "./db.ts";
import { ApiError, cookieValue, notFound, readJson, sendEmpty, sendJson, signInAgain } from "./http.ts";

const COOKIE = "oddment_session";
const COOKIE_FLAGS = "HttpOnly; SameSite=Lax; Path=/";
const COOKIE_YEAR = 60 * 60 * 24 * 365;
const emailTaken = (): ApiError => new ApiError(409, { email: "That email already has an account." });
const EMAIL_SHAPE = /^[^\s@\0]+@[^\s@\0]+\.[^\s@\0]+$/;
const MIN_PASSWORD = 8;
const KEY_BYTES = 32;

const derive = promisify(scrypt) as (password: string, salt: string, length: number) => Promise<Buffer>;

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("base64url");
  return `${salt}:${(await derive(password, salt, KEY_BYTES)).toString("base64url")}`;
}

async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [salt = "", key = ""] = stored.split(":");
  return timingSafeEqual(await derive(password, salt, KEY_BYTES), Buffer.from(key, "base64url"));
}

const tokenHash = (token: string): string => createHash("sha256").update(token).digest("hex");

type Session = { accountId: string; email: string; deviceId: string; deviceName: string };

const sessionBody = (session: Session) => ({
  user: { id: session.accountId, email: session.email },
  device: { id: session.deviceId, name: session.deviceName },
});

async function findSession(token: string): Promise<Session | null> {
  const found = await db.query<{ account_id: string; email: string; device_id: string; name: string }>(
    `UPDATE devices d SET last_seen_at = now()
       FROM sessions s, accounts a
      WHERE s.token_hash = $1 AND d.id = s.device_id AND a.id = d.account_id
      RETURNING a.id AS account_id, a.email, d.id AS device_id, d.name`,
    [tokenHash(token)],
  );
  const row = found.rows[0];
  return row ? { accountId: row.account_id, email: row.email, deviceId: row.device_id, deviceName: row.name } : null;
}

/** The session behind this request; answers 503 then 401 in the published order. */
export async function requireSession(req: IncomingMessage): Promise<Session> {
  await requireDatabase();
  const token = cookieValue(req, COOKIE);
  const session = token ? await findSession(token) : null;
  if (!session) throw signInAgain();
  return session;
}

async function openSession(client: Queryable, accountId: string, email: string): Promise<{ session: Session; cookie: string }> {
  const issued = await client.query<{ devices_issued: number }>(
    "UPDATE accounts SET devices_issued = devices_issued + 1 WHERE id = $1 RETURNING devices_issued",
    [accountId],
  );
  const { devices_issued: number } = issued.rows[0] as { devices_issued: number };
  const deviceId = randomUUID();
  const deviceName = `Device ${number}`;
  await client.query("INSERT INTO devices (id, account_id, name, number) VALUES ($1, $2, $3, $4)", [deviceId, accountId, deviceName, number]);
  const token = randomBytes(32).toString("base64url");
  await client.query("INSERT INTO sessions (token_hash, device_id) VALUES ($1, $2)", [tokenHash(token), deviceId]);
  return {
    session: { accountId, email, deviceId, deviceName },
    cookie: `${COOKIE}=${token}; Max-Age=${COOKIE_YEAR}; ${COOKIE_FLAGS}`,
  };
}

export async function getSession(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const token = cookieValue(req, COOKIE);
  if (!token) return sendJson(res, 200, {});
  await requireDatabase();
  const session = await findSession(token);
  sendJson(res, 200, session ? sessionBody(session) : {});
}

export async function createAccount(req: IncomingMessage, res: ServerResponse): Promise<void> {
  await requireDatabase();
  const body = await readJson(req);
  const email = typeof body["email"] === "string" ? body["email"].trim().toLowerCase() : "";
  const password = typeof body["password"] === "string" ? body["password"] : "";
  const wellFormed = EMAIL_SHAPE.test(email);
  const taken = wellFormed ? await db.query("SELECT 1 FROM accounts WHERE email = $1", [email]) : null;
  if (taken?.rowCount) throw emailTaken();
  const errors: Record<string, string> = {};
  if (!wellFormed) errors["email"] = "Enter a valid email address.";
  if (password.length < MIN_PASSWORD) errors["password"] = "Use at least 8 characters.";
  if (Object.keys(errors).length) throw new ApiError(422, errors);
  const hash = await hashPassword(password);
  const opened = await transaction(async (client) => {
    const accountId = randomUUID();
    const inserted = await client.query(
      "INSERT INTO accounts (id, email, password_hash) VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING",
      [accountId, email, hash],
    );
    if (!inserted.rowCount) throw emailTaken();
    return openSession(client, accountId, email);
  });
  sendJson(res, 201, sessionBody(opened.session), { "Set-Cookie": opened.cookie });
}

export async function createSession(req: IncomingMessage, res: ServerResponse): Promise<void> {
  await requireDatabase();
  const body = await readJson(req);
  const email = typeof body["email"] === "string" ? body["email"].trim().toLowerCase() : "";
  const password = typeof body["password"] === "string" ? body["password"] : "";
  const found = EMAIL_SHAPE.test(email)
    ? await db.query<{ id: string; password_hash: string }>("SELECT id, password_hash FROM accounts WHERE email = $1", [email])
    : null;
  const account = found?.rows[0];
  if (!account || !(await passwordMatches(password, account.password_hash))) {
    throw new ApiError(401, { form: "That email and password do not match." });
  }
  const opened = await transaction((client) => openSession(client, account.id, email));
  sendJson(res, 200, sessionBody(opened.session), { "Set-Cookie": opened.cookie });
}

export async function deleteSession(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const session = await requireSession(req);
  await db.query("DELETE FROM devices WHERE id = $1", [session.deviceId]);
  sendEmpty(res, { "Set-Cookie": `${COOKIE}=; Max-Age=0; ${COOKIE_FLAGS}` });
}

export async function listDevices(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const session = await requireSession(req);
  const found = await db.query<{ id: string; name: string; last_seen_at: Date }>(
    "SELECT id, name, last_seen_at FROM devices WHERE account_id = $1 ORDER BY number",
    [session.accountId],
  );
  sendJson(res, 200, {
    devices: found.rows.map((row) => ({
      id: row.id,
      name: row.name,
      current: row.id === session.deviceId,
      lastSeenAt: row.last_seen_at.toISOString(),
    })),
  });
}

export async function deleteDevice(req: IncomingMessage, res: ServerResponse, deviceId: string): Promise<void> {
  const session = await requireSession(req);
  if (deviceId === session.deviceId) throw new ApiError(409, { form: "Use Sign out on this device." });
  const removed = await db.query("DELETE FROM devices WHERE id::text = $1 AND account_id = $2", [deviceId, session.accountId]);
  if (!removed.rowCount) throw notFound();
  sendEmpty(res);
}
