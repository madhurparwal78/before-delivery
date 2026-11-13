import { randomUUID } from "node:crypto";
import { recordAudit } from "./audit.js";
import { type SessionUser, USER_SELECT, endSession, hashPassword, requireRole, requireUser, signIn, startSession } from "./auth.js";
import { isUniqueViolation, many, one, pool, tx } from "./db.js";
import { FieldErrors, refuse } from "./errors.js";
import type { ApiRequest, ApiResult } from "./http.js";
import { email as validEmail, text } from "./validate.js";

// Studio accounts, sessions and juror accounts (brief: API, Accounts).

function userView(user: SessionUser) {
  return { id: user.id, role: user.role, name: user.name, email: user.email, studioId: user.studio_id, studioName: user.studio_name };
}

async function emailTaken(address: unknown): Promise<boolean> {
  return typeof address === "string" && (await one(pool, "SELECT 1 FROM users WHERE lower(email) = lower($1)", [address.trim()])) !== null;
}

const PASSWORD_COPY = "Use a password of at least 10 characters.";

function checkPassword(errors: FieldErrors, value: unknown, field: string): void {
  errors.check(typeof value === "string" && [...value].length >= 10 && value.length <= 200, field, PASSWORD_COPY);
}

export async function createStudio(req: ApiRequest): Promise<ApiResult> {
  const b = req.body;
  if (await emailTaken(b.email)) throw refuse("email_taken");
  if (typeof b.studioName === "string" && await one(pool, "SELECT 1 FROM studios WHERE lower(name) = lower($1)", [b.studioName.trim()])) {
    throw refuse("studio_name_taken");
  }
  const errors = new FieldErrors();
  const studioName = text(b.studioName, 2, 80);
  const contactName = text(b.contactName, 2, 80);
  const address = validEmail(b.email);
  errors.check(studioName !== null, "studioName", "Give a studio name of 2 to 80 characters.");
  errors.check(contactName !== null, "contactName", "Give a contact name of 2 to 80 characters.");
  errors.check(address !== null, "email", "Enter a valid email address.");
  checkPassword(errors, b.password, "password");
  errors.throwIfAny();
  const passwordHash = await hashPassword(b.password as string);
  try {
    const { user, cookie } = await tx(async (client) => {
      const studioId = randomUUID();
      const userId = randomUUID();
      await client.query("INSERT INTO studios (id, name, contact_name) VALUES ($1, $2, $3)", [studioId, studioName, contactName]);
      await client.query("INSERT INTO users (id, role, name, email, password_hash, studio_id) VALUES ($1, 'studio', $2, $3, $4, $5)",
        [userId, contactName, address, passwordHash, studioId]);
      const created = (await one<SessionUser>(client, `${USER_SELECT} WHERE u.id = $1`, [userId])) as SessionUser;
      return { user: created, cookie: await startSession(client, userId) };
    });
    return { status: 201, json: { user: userView(user) }, headers: { "Set-Cookie": cookie } };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    throw refuse((error as Error & { constraint?: string }).constraint === "users_email_key" ? "email_taken" : "studio_name_taken");
  }
}

export async function createSession(req: ApiRequest): Promise<ApiResult> {
  const { email, password } = req.body;
  const session = typeof email === "string" && typeof password === "string" ? await signIn(email.trim(), password) : null;
  if (!session) throw refuse("invalid_credentials");
  return { status: 200, json: { user: userView(session.user) }, headers: { "Set-Cookie": session.cookie } };
}

export async function getSession(req: ApiRequest): Promise<ApiResult> {
  return { status: 200, json: { user: userView(await requireUser(req)) } };
}

export async function deleteSession(req: ApiRequest): Promise<ApiResult> {
  await requireUser(req);
  return { status: 204, headers: { "Set-Cookie": await endSession(req.sessionToken as string) } };
}

export async function listStudios(req: ApiRequest): Promise<ApiResult> {
  const user = await requireUser(req);
  requireRole(user, "director", "juror");
  return { status: 200, json: { studios: await many(pool, "SELECT id, name FROM studios ORDER BY lower(name), id") } };
}

function jurorView(row: { id: string; name: string; email: string; studio_id: string | null }) {
  return { id: row.id, name: row.name, email: row.email, studioId: row.studio_id };
}

export async function createJuror(req: ApiRequest): Promise<ApiResult> {
  const user = await requireUser(req);
  requireRole(user, "director");
  const b = req.body;
  if (await emailTaken(b.email)) throw refuse("email_taken");
  const errors = new FieldErrors();
  const name = text(b.name, 2, 80);
  const address = validEmail(b.email);
  errors.check(name !== null, "name", "Give a juror name of 2 to 80 characters.");
  errors.check(address !== null, "email", "Enter a valid email address.");
  checkPassword(errors, b.password, "password");
  const studioId = b.studioId ?? null;
  if (studioId !== null) {
    const known = typeof studioId === "string" && (await one(pool, "SELECT 1 FROM studios WHERE id = $1", [studioId])) !== null;
    errors.check(known, "studioId", "Choose a studio, or none.");
  }
  errors.throwIfAny();
  const passwordHash = await hashPassword(b.password as string);
  const id = randomUUID();
  try {
    await tx(async (client) => {
      await client.query("INSERT INTO users (id, role, name, email, password_hash, studio_id) VALUES ($1, 'juror', $2, $3, $4, $5)",
        [id, name, address, passwordHash, studioId]);
      await recordAudit(client, "juror.create", "juror", id, { name });
    });
  } catch (error) {
    throw isUniqueViolation(error) ? refuse("email_taken") : error;
  }
  return { status: 201, json: { juror: { id, name, email: address, studioId } } };
}

export async function listJurors(req: ApiRequest): Promise<ApiResult> {
  const user = await requireUser(req);
  requireRole(user, "director");
  const rows = await many<{ id: string; name: string; email: string; studio_id: string | null }>(pool,
    "SELECT id, name, email, studio_id FROM users WHERE role = 'juror' ORDER BY lower(name), id");
  return { status: 200, json: { jurors: rows.map(jurorView) } };
}
