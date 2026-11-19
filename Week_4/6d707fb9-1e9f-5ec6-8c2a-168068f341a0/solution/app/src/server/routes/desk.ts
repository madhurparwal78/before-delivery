import { randomBytes, scrypt as scryptCallback, timingSafeEqual, type BinaryLike } from "node:crypto";
import { promisify } from "node:util";
import { config } from "../config";
import { now, pool, transaction } from "../db";
import { ApiError, empty, fieldErrors, hashToken, ok, route, sessionCookie, type Answer, type Session } from "../http";
import { addSeconds } from "../figures";
import { instant, newId, object } from "../domain";

const scrypt = promisify<BinaryLike, BinaryLike, number, Buffer>(scryptCallback);
const EMPTY = "Give a value here.";
const WRONG_SIGN_IN = "That email and password don't match.";
const PASSWORD_LENGTH = "A password has at least 10 characters.";

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 32);
  return `${salt.toString("hex")}:${key.toString("hex")}`;
}

async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [salt, key] = stored.split(":") as [string, string];
  return timingSafeEqual(await scrypt(password, Buffer.from(salt, "hex"), 32), Buffer.from(key, "hex"));
}

async function startSession(assessor: { id: string; name: string; email: string }, status: number): Promise<Answer> {
  const token = randomBytes(32).toString("base64url");
  await pool.query(`INSERT INTO sessions (token_hash, assessor_id, ends_at) VALUES ($1, $2, $3)`, [
    hashToken(token),
    assessor.id,
    addSeconds(now(), config.sessionSeconds),
  ]);
  return {
    status,
    json: { assessor: { id: assessor.id, name: assessor.name, email: assessor.email } },
    headers: { "Set-Cookie": sessionCookie(token) },
  };
}

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const isEmail = (value: string): boolean => /^[^\s@]+@[^\s@]+$/.test(value);

route("GET", "/api/health", {
  auth: false,
  handle: async () => ok({ status: "ok" }),
});

route("POST", "/api/sign-up", {
  auth: false,
  input: "json",
  handle: async (call) => {
    const body = object(call.body);
    const name = text(body.name);
    const email = text(body.email).toLowerCase();
    const password = typeof body.password === "string" ? body.password : "";
    const fields: Record<string, string> = {};
    if (!name) fields.name = EMPTY;
    if (!isEmail(email)) fields.email = EMPTY;
    if (password.length < 10) fields.password = PASSWORD_LENGTH;
    if (Object.keys(fields).length) throw fieldErrors(fields);
    const id = newId();
    const { rowCount } = await pool.query(
      `INSERT INTO assessors (id, name, email, password_hash) VALUES ($1, $2, $3, $4) ON CONFLICT (email) DO NOTHING`,
      [id, name, email, await hashPassword(password)],
    );
    if (!rowCount) throw new ApiError(409, "email_taken", "That email already has a desk. Sign in instead.");
    return startSession({ id, name, email }, 201);
  },
});

route("POST", "/api/sign-in", {
  auth: false,
  input: "json",
  handle: async (call) => {
    const body = object(call.body);
    const { rows } = await pool.query(`SELECT * FROM assessors WHERE email = $1`, [text(body.email).toLowerCase()]);
    const assessor = rows[0];
    if (!assessor || typeof body.password !== "string" || !(await passwordMatches(body.password, assessor.password_hash))) {
      throw new ApiError(401, "invalid_credentials", WRONG_SIGN_IN);
    }
    return startSession(assessor, 200);
  },
});

route("POST", "/api/sign-out", {
  input: "emptyOrJson",
  handle: async (call) => {
    await pool.query(`UPDATE sessions SET ended = true WHERE token_hash = $1`, [(call.session as Session).tokenHash]);
    return empty();
  },
});

route("GET", "/api/session", {
  handle: async (call) => {
    const session = call.session as Session;
    return ok({
      assessor: { id: session.assessorId, name: session.name, email: session.email },
      endsAt: instant(session.endsAt),
    });
  },
});

route("POST", "/api/password", {
  input: "json",
  handle: async (call) => {
    const session = call.session as Session;
    const body = object(call.body);
    const stored = (await pool.query(`SELECT password_hash FROM assessors WHERE id = $1`, [session.assessorId])).rows[0];
    if (typeof body.currentPassword !== "string" || !(await passwordMatches(body.currentPassword, stored.password_hash))) {
      throw new ApiError(401, "invalid_credentials", WRONG_SIGN_IN);
    }
    if (typeof body.newPassword !== "string" || body.newPassword.length < 10) {
      throw fieldErrors({ newPassword: PASSWORD_LENGTH });
    }
    const newHash = await hashPassword(body.newPassword);
    await transaction(async (tx) => {
      await tx.query(`UPDATE assessors SET password_hash = $2 WHERE id = $1`, [session.assessorId, newHash]);
      await tx.query(`UPDATE sessions SET ended = true WHERE assessor_id = $1 AND token_hash <> $2`, [session.assessorId, session.tokenHash]);
    });
    return empty();
  },
});
