import { randomBytes, randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { z } from "zod";
import { nowMs } from "./clock.js";
import { isUniqueViolation, pool } from "./db.js";
import type { Quizmaster } from "../shared/schemas.js";
import { apiError, fieldsOf, notSignedIn, validationFailed } from "./errors.js";
import { sha256Hex } from "./hash.js";
import { hashPassword, verifyPassword } from "./passwords.js";

const SESSION_COOKIE = "lastbell_session";
export const SESSION_SECONDS = 30 * 24 * 3600;

export const hashSession = (token: string): string => sha256Hex(token);

export function sessionToken(req: IncomingMessage): string | null {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === SESSION_COOKIE) return value.join("=");
  }
  return null;
}

export const sessionCookie = (token: string, seconds: number): string =>
  `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}`;

export async function currentQuizmaster(req: IncomingMessage): Promise<Quizmaster> {
  const token = sessionToken(req);
  if (!token) throw notSignedIn();
  const found = await pool.query<{ id: string; email: string; display_name: string }>(
    `SELECT q.id, q.email, q.display_name FROM sessions s JOIN quizmasters q ON q.id = s.quizmaster_id
     WHERE s.token_hash = $1 AND s.expires_at > $2`,
    [hashSession(token), nowMs()],
  );
  const row = found.rows[0];
  if (!row) throw notSignedIn();
  return { id: row.id, email: row.email, displayName: row.display_name };
}

async function startSession(quizmasterId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await pool.query("INSERT INTO sessions (token_hash, quizmaster_id, expires_at) VALUES ($1, $2, $3)", [hashSession(token), quizmasterId, nowMs() + SESSION_SECONDS * 1000]);
  return token;
}

export async function endSession(req: IncomingMessage): Promise<void> {
  const token = sessionToken(req);
  if (token) await pool.query("DELETE FROM sessions WHERE token_hash = $1", [hashSession(token)]);
}

const signupBody = z.object({
  email: z.string("Enter an email address").trim().regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Enter an email address"),
  password: z.string("Password must be at least 10 characters").min(10, "Password must be at least 10 characters"),
  displayName: z.string("Display name must be 1 to 60 characters").trim().min(1, "Display name must be 1 to 60 characters").max(60, "Display name must be 1 to 60 characters"),
});

const loginBody = z.object({ email: z.string(), password: z.string() });

// An email that already has an account is a conflict (409) and outranks field validation (422).
export async function signUp(body: unknown): Promise<{ quizmaster: Quizmaster; token: string }> {
  const requested = z.object({ email: z.string() }).safeParse(body);
  if (requested.success) {
    const taken = await pool.query("SELECT 1 FROM quizmasters WHERE email_key = $1", [requested.data.email.trim().toLowerCase()]);
    if (taken.rowCount) throw apiError(409, "email_taken");
  }
  const parsed = signupBody.safeParse(body);
  if (!parsed.success) {
    throw validationFailed(fieldsOf(parsed.error));
  }
  const { email, password, displayName } = parsed.data;
  const id = randomUUID();
  try {
    await pool.query(
      "INSERT INTO quizmasters (id, email, email_key, display_name, password_hash, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
      [id, email, email.toLowerCase(), displayName, await hashPassword(password), nowMs()],
    );
  } catch (error) {
    throw isUniqueViolation(error) ? apiError(409, "email_taken") : error;
  }
  return { quizmaster: { id, email, displayName }, token: await startSession(id) };
}

export async function signIn(body: unknown): Promise<{ quizmaster: Quizmaster; token: string }> {
  const parsed = loginBody.safeParse(body);
  const invalid = apiError(401, "invalid_credentials");
  if (!parsed.success) throw invalid;
  const found = await pool.query<{ id: string; email: string; display_name: string; password_hash: string }>(
    "SELECT id, email, display_name, password_hash FROM quizmasters WHERE email_key = $1",
    [parsed.data.email.trim().toLowerCase()],
  );
  const row = found.rows[0];
  if (!row || !(await verifyPassword(parsed.data.password, row.password_hash))) throw invalid;
  return { quizmaster: { id: row.id, email: row.email, displayName: row.display_name }, token: await startSession(row.id) };
}
