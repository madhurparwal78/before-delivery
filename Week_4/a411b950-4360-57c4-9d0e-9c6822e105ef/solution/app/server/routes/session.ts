import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { one, query } from "../db.js";
import { cookies, fail, sendJson } from "../http.js";
import type { Context, Route } from "../router.js";
import { asObject, Checker } from "../validate.js";
import { pendingMail } from "../mail.js";
import { reference } from "./enquiries.js";

const SESSION_COOKIE = "earshot_session";
const SESSION_DAYS = 14;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("base64")}$${scryptSync(password, salt, 32).toString("base64")}`;
}

function passwordMatches(password: string, stored: string): boolean {
  const [, salt = "", hash = ""] = stored.split("$");
  const expected = Buffer.from(hash, "base64");
  const actual = scryptSync(password, Buffer.from(salt, "base64"), expected.length);
  return timingSafeEqual(actual, expected);
}

const tokenHash = (token: string): string => createHash("sha256").update(token).digest("hex");

/** The signed-in operator's email, or null without a live session. */
export async function sessionOperator(req: IncomingMessage): Promise<string | null> {
  const token = cookies(req).get(SESSION_COOKIE);
  if (!token) return null;
  const row = await one<{ operator_email: string }>(
    "SELECT operator_email FROM sessions WHERE token_hash = $1 AND expires_at > now()",
    [tokenHash(token)],
  );
  return row?.operator_email ?? null;
}

async function signIn({ json, res }: Context): Promise<void> {
  const check = new Checker(asObject(json)).writable(["email", "password"]);
  const email = check.body.email;
  const password = check.body.password;
  if (typeof email !== "string") check.error("email", "Enter your email.");
  if (typeof password !== "string") check.error("password", "Enter your password.");
  check.done();
  const operator = await one<{ email: string; password_hash: string }>(
    "SELECT email, password_hash FROM operators WHERE lower(email) = lower($1)",
    [email],
  );
  if (!operator || !passwordMatches(String(password), operator.password_hash)) {
    fail(401, "invalid_credentials", "That email and password don’t match.");
  }
  const token = randomBytes(32).toString("base64url");
  await query(
    `INSERT INTO sessions (token_hash, operator_email, expires_at) VALUES ($1, $2, now() + interval '${SESSION_DAYS} days')`,
    [tokenHash(token), operator.email],
  );
  sendJson(res, 200, { operator: { email: operator.email } }, {
    "Set-Cookie": `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86_400}`,
  });
}

async function signOut({ req, res }: Context): Promise<void> {
  const token = cookies(req).get(SESSION_COOKIE);
  if (token) await query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash(token)]);
  res.writeHead(204, { "Set-Cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` });
  res.end();
}

interface Settings {
  time_zone: string;
  operator_email: string;
}

export async function settings(): Promise<Settings> {
  const row = await one<Settings>("SELECT time_zone, operator_email FROM settings WHERE id = 1");
  if (!row) fail(503, "database_unavailable", "Settings are not ready yet.");
  return row;
}

function isTimeZone(name: string): boolean {
  if (!/^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/.test(name)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

async function readSettings({ res }: Context): Promise<void> {
  sendJson(res, 200, await settings());
}

async function saveSettings({ json, res }: Context): Promise<void> {
  const check = new Checker(asObject(json)).writable(["time_zone"]);
  const zone = check.body.time_zone;
  if (typeof zone !== "string" || !isTimeZone(zone)) check.error("time_zone", "Choose an IANA time zone such as America/Toronto.");
  check.done();
  await query("UPDATE settings SET time_zone = $1 WHERE id = 1", [zone]);
  sendJson(res, 200, await settings());
}

async function readMailQueue({ res }: Context): Promise<void> {
  const emails = await pendingMail();
  sendJson(res, 200, {
    server_time: new Date().toISOString(),
    emails: emails.map((mail) => ({
      kind: mail.kind,
      reference: reference(mail),
      to: mail.to,
      queued_at: mail.queued_at.toISOString(),
      retry_at: mail.retry_at?.toISOString() ?? null,
    })),
  });
}

export const sessionRoutes: Route[] = [
  { pattern: "/api/console/session", methods: { POST: { handler: signIn }, DELETE: { handler: signOut } } },
  { pattern: "/api/console/mail-queue", methods: { GET: { handler: readMailQueue } } },
  { pattern: "/api/console/settings", methods: { GET: { handler: readSettings }, PUT: { handler: saveSettings } } },
];
