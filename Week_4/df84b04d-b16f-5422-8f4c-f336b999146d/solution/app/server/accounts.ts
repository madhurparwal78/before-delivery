import { createHash, randomBytes, randomInt, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Db } from "./db.js";
import { pool, tx } from "./db.js";
import { config } from "./config.js";
import { ALERTS, FIELD_ERRORS } from "../shared/copy.js";
import type { MeResponse, Person } from "../shared/types.js";
import { ApiError, invalid, type Session } from "./http.js";
import { MailError, sendMail, signupCodeMail, takenMail } from "./mail.js";

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, length: number) => Promise<Buffer>;
const SESSION_DAYS = 30;
const MAX_CODE_ATTEMPTS = 10;
const EMAIL_PATTERN = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

export const normalizeEmail = (value: string) => value.trim().toLowerCase();
export const isEmail = (value: string) => value.length <= 254 && EMAIL_PATTERN.test(value);
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, 32);
  return `${salt.toString("hex")}:${derived.toString("hex")}`;
}

const SPARE_HASH = hashPassword(randomBytes(12).toString("hex"));

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(":");
  const derived = await scryptAsync(password, Buffer.from(salt ?? "", "hex"), 32);
  return timingSafeEqual(derived, Buffer.from(hash ?? "", "hex"));
}

export const sessionCookie = (token: string) =>
  `twig_session=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${new Date(Date.now() + SESSION_DAYS * 86_400_000).toUTCString()}`;
export const clearedCookie = () => "twig_session=; Path=/; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT";

async function startSession(client: Db | typeof pool, accountId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await client.query("INSERT INTO sessions (token_hash, account_id) VALUES ($1, $2)", [sha256(token), accountId]);
  return token;
}

export async function endSession(token: string): Promise<void> {
  await pool.query("DELETE FROM sessions WHERE token_hash = $1", [sha256(token)]);
}

export async function sessionFor(token: string | undefined): Promise<Session | null> {
  if (token === undefined || token === "") return null;
  const found = await pool.query<{ id: string; email: string; name: string; hide_completed: boolean }>(
    `SELECT a.id, a.email, a.name, a.hide_completed FROM sessions s JOIN accounts a ON a.id = s.account_id
     WHERE s.token_hash = $1 AND a.confirmed`,
    [sha256(token)],
  );
  const row = found.rows[0];
  return row === undefined
    ? null
    : { accountId: row.id, email: row.email, name: row.name, hideCompleted: row.hide_completed };
}

const personOf = (session: Session): Person => ({ id: session.accountId, email: session.email, name: session.name });

export async function createAccount(
  client: Db | typeof pool,
  input: { email: string; name: string; password: string; confirmed: boolean; hideCompleted?: boolean },
): Promise<string> {
  const id = randomUUID();
  await client.query(
    `INSERT INTO accounts (id, email, name, password_hash, confirmed, hide_completed) VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, input.email, input.name, await hashPassword(input.password), input.confirmed, input.hideCompleted ?? false],
  );
  await client.query("INSERT INTO outline_seqs (owner_id, seq) VALUES ($1, 0)", [id]);
  return id;
}

interface SignupInput {
  name: string;
  email: string;
  password: string;
}

export function validateSignup(body: Record<string, unknown>): SignupInput {
  const errors: Record<string, string> = {};
  const name = typeof body.name === "string" ? body.name.replace(/[\u0000-\u001f\u007f]+/g, " ").trim() : "";
  const email = typeof body.email === "string" ? normalizeEmail(body.email) : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (name === "" || Array.from(name).length > 80) errors.name = FIELD_ERRORS.name;
  if (!isEmail(email)) errors.email = FIELD_ERRORS.email;
  if (Array.from(password).length < 10) errors.password = FIELD_ERRORS.password;
  if (Object.keys(errors).length > 0) throw invalid(errors);
  return { name, email, password };
}

async function deliver(to: string, mail: { subject: string; body: string }): Promise<void> {
  try {
    await sendMail(to, mail.subject, mail.body);
  } catch (error) {
    if (error instanceof MailError) throw new ApiError(503, { error: "mail_unavailable" });
    throw error;
  }
}

export async function signUp(input: SignupInput): Promise<void> {
  const existing = await pool.query<{ confirmed: boolean }>("SELECT confirmed FROM accounts WHERE email = $1", [input.email]);
  if (existing.rows[0]?.confirmed === true) {
    await deliver(input.email, takenMail());
    return;
  }
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const hash = await hashPassword(input.password);
  await tx(async (client) => {
    const row = await client.query<{ id: string }>(
      `INSERT INTO accounts (id, email, name, password_hash) VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, password_hash = EXCLUDED.password_hash
       WHERE accounts.confirmed = false RETURNING id`,
      [randomUUID(), input.email, input.name, hash],
    );
    const id = row.rows[0]?.id;
    if (id === undefined) return;
    await client.query("INSERT INTO outline_seqs (owner_id, seq) VALUES ($1, 0) ON CONFLICT DO NOTHING", [id]);
    await client.query(
      `INSERT INTO pending_codes (account_id, code_hash, expires_at, attempts)
       VALUES ($1, $2, now() + $3 * interval '1 second', 0)
       ON CONFLICT (account_id) DO UPDATE SET code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at, attempts = 0`,
      [id, sha256(`${id}:${code}`), config.confirmCodeSeconds],
    );
  });
  await deliver(input.email, signupCodeMail(input.name, code));
}

export async function confirmSignup(email: string, code: string): Promise<{ token: string; person: Person }> {
  const wrong = invalid({ code: FIELD_ERRORS.wrongCode });
  const found = await pool.query<{ id: string; name: string; code_hash: string; attempts: number; expired: boolean }>(
    `SELECT a.id, a.name, p.code_hash, p.attempts, p.expires_at <= now() AS expired
     FROM accounts a JOIN pending_codes p ON p.account_id = a.id WHERE a.email = $1 AND NOT a.confirmed`,
    [email],
  );
  const row = found.rows[0];
  if (row === undefined || row.attempts >= MAX_CODE_ATTEMPTS) throw wrong;
  if (row.code_hash !== sha256(`${row.id}:${code}`)) {
    await pool.query("UPDATE pending_codes SET attempts = attempts + 1 WHERE account_id = $1", [row.id]);
    throw wrong;
  }
  if (row.expired) throw invalid({ code: FIELD_ERRORS.expiredCode });
  const token = await tx(async (client) => {
    await client.query("UPDATE accounts SET confirmed = true WHERE id = $1", [row.id]);
    await client.query("DELETE FROM pending_codes WHERE account_id = $1", [row.id]);
    return startSession(client, row.id);
  });
  return { token, person: { id: row.id, email, name: row.name } };
}

export async function signIn(email: string, password: string): Promise<{ token: string; person: Person }> {
  const found = await pool.query<{ id: string; name: string; password_hash: string; confirmed: boolean }>(
    "SELECT id, name, password_hash, confirmed FROM accounts WHERE email = $1",
    [email],
  );
  const row = found.rows[0];
  const stored = row?.password_hash ?? (await SPARE_HASH);
  const matches = await verifyPassword(password, stored);
  if (row === undefined || !row.confirmed || !matches) {
    throw new ApiError(401, { error: "invalid_credentials", message: ALERTS.signInFailed });
  }
  return { token: await startSession(pool, row.id), person: { id: row.id, email, name: row.name } };
}

export async function meFor(session: Session): Promise<MeResponse> {
  const shared = await pool.query<{ bullet_id: string; text: string; name: string }>(
    `SELECT s.bullet_id, COALESCE(o.text, b.text) AS text, owner.name
     FROM shares s
     JOIN bullets b ON b.id = s.bullet_id AND b.trashed_at IS NULL
     LEFT JOIN bullets o ON o.id = b.mirror_of AND o.trashed_at IS NULL
     JOIN accounts owner ON owner.id = s.owner_id
     WHERE s.account_id = $1 AND s.status = 'accepted' ORDER BY s.created_at`,
    [session.accountId],
  );
  return {
    user: { ...personOf(session), hideCompleted: session.hideCompleted },
    shared: shared.rows.map((row) => ({ bulletId: row.bullet_id, text: row.text, owner: { name: row.name } })),
  };
}

export async function setHideCompleted(session: Session, value: boolean): Promise<void> {
  await pool.query("UPDATE accounts SET hide_completed = $2 WHERE id = $1", [session.accountId, value]);
}
