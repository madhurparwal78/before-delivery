import { SESSION_COOKIE, callerOf, type UserRow } from "../access";
import { maybeOne, pool, transaction } from "../db";
import { ApiError, empty, invalid, json, parseJson, serviceDown, setCookie, signInRequired, text, type Reply, type Request } from "../http";
import { MailError, send } from "../services/mail";
import { digest, hashSecret, newCode, newToken, secretMatches } from "../security";
import { config } from "../config";
import { MESSAGES, signupErrors } from "../../shared/rules";
import type { Account } from "../../shared/types";

const SESSION_SECONDS = 30 * 24 * 3600;

const accountOf = (user: UserRow): Account => ({ id: user.id, display_name: user.display_name, email: user.email });

async function startSession(request: Request, userId: string): Promise<void> {
  const token = newToken();
  await pool.query(`INSERT INTO sessions (token_hash, user_id) VALUES ($1, $2)`, [digest(token), userId]);
  setCookie(request.res, SESSION_COOKIE, token, SESSION_SECONDS);
}

interface Credentials extends UserRow {
  password_hash: string;
}

const byEmail = (email: string): Promise<Credentials | null> =>
  maybeOne<Credentials>(pool, `SELECT id, display_name, email, verified, password_hash FROM users WHERE lower(email) = lower($1)`, [email]);

export async function signUp(request: Request): Promise<Reply> {
  const body = parseJson(request.body);
  const displayName = text(body["display_name"]).trim();
  const email = text(body["email"]).trim();
  const password = text(body["password"]);
  const errors = signupErrors(displayName, email, password);
  if (Object.keys(errors).length) throw invalid(errors);
  const existing = await byEmail(email);
  if (existing?.verified) throw invalid({ email: MESSAGES.emailTaken });
  const code = newCode();
  try {
    await send({ to: email, subject: "Your Pinsheet code", text: `Your Pinsheet code is ${code}.` });
  } catch (error) {
    if (error instanceof MailError) throw serviceDown("mail_unavailable");
    throw error;
  }
  const passwordHash = await hashSecret(password);
  const stored = await transaction(async (db) => {
    const account = await maybeOne<{ id: string }>(
      db,
      `INSERT INTO users (display_name, email, password_hash) VALUES ($1, $2, $3)
       ON CONFLICT ((lower(email))) DO UPDATE SET display_name = EXCLUDED.display_name, password_hash = EXCLUDED.password_hash WHERE users.verified = false
       RETURNING id`,
      [displayName, email, passwordHash],
    );
    if (!account) return false;
    await db.query(
      `INSERT INTO verification_codes (user_id, code_hash, expires_at) VALUES ($1, $2, now() + make_interval(secs => $3))
       ON CONFLICT (user_id) DO UPDATE SET code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at`,
      [account.id, digest(code), config.verifyCodeTtlSeconds],
    );
    return true;
  });
  if (!stored) throw invalid({ email: MESSAGES.emailTaken });
  return json(202, { status: "code_sent" });
}

export async function verify(request: Request): Promise<Reply> {
  const body = parseJson(request.body);
  const user = await maybeOne<UserRow>(
    pool,
    `SELECT u.id, u.display_name, u.email, u.verified FROM users u JOIN verification_codes c ON c.user_id = u.id
     WHERE lower(u.email) = lower($1) AND c.code_hash = $2 AND c.expires_at > now()`,
    [text(body["email"]).trim(), digest(text(body["code"]).trim())],
  );
  if (!user) throw invalid({ code: MESSAGES.codeWrong });
  await transaction(async (db) => {
    await db.query(`UPDATE users SET verified = true WHERE id = $1`, [user.id]);
    await db.query(`DELETE FROM verification_codes WHERE user_id = $1`, [user.id]);
  });
  await startSession(request, user.id);
  return json(200, { user: accountOf(user) });
}

export async function signIn(request: Request): Promise<Reply> {
  const body = parseJson(request.body);
  const user = await byEmail(text(body["email"]).trim());
  if (!user || !(await secretMatches(text(body["password"]), user.password_hash))) throw new ApiError(401, { error: "wrong_credentials" });
  if (!user.verified) throw new ApiError(403, { error: "unconfirmed" });
  await startSession(request, user.id);
  return json(200, { user: accountOf(user) });
}

export async function signOut(request: Request): Promise<Reply> {
  const token = request.cookies[SESSION_COOKIE];
  if (token) await pool.query(`DELETE FROM sessions WHERE token_hash = $1`, [digest(token)]);
  setCookie(request.res, SESSION_COOKIE, "", 0);
  return empty(204);
}

export async function me(request: Request): Promise<Reply> {
  const { user } = await callerOf(request);
  if (!user) throw signInRequired();
  return json(200, { user: accountOf(user) });
}
