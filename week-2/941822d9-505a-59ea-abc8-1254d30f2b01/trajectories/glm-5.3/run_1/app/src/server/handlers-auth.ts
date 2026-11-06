import bcrypt from "bcryptjs";
import { err, notFound, validationError } from "./errors.ts";
import { query } from "./db.ts";
import { createSession, destroySession, SESSION_COOKIE, type SessionUser } from "./session.ts";
import { serialiseUser } from "./dto.ts";
import type { Ctx, PublicCtx } from "./route.ts";

const findUser = async (email: string): Promise<SessionUser & { password_hash: string }> => {
  const { rows } = await query<SessionUser & { password_hash: string }>(
    `SELECT id, email, display_name, role, organisation_id, licence_number,
            to_char(date_of_birth, 'YYYY-MM-DD') AS date_of_birth, password_hash
       FROM users WHERE lower(email) = lower($1)`,
    [email],
  );
  const row = rows[0];
  if (!row) throw validationError({ password: "Email or password is incorrect." });
  return row;
};

export async function signIn(ctx: PublicCtx): Promise<void> {
  const body = (ctx.body ?? {}) as Record<string, unknown>;
  const errors: Record<string, string> = {};
  for (const key of Object.keys(body)) {
    if (key !== "email" && key !== "password") errors[key] = "This field is not accepted.";
  }
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  let user: (SessionUser & { password_hash: string }) | null = null;
  if (email.length === 0 || password.length === 0) {
    errors.password = "Email or password is incorrect.";
  } else {
    try {
      const candidate = await findUser(email);
      if (await bcrypt.compare(password, candidate.password_hash)) user = candidate;
    } catch {
      // unknown email
    }
    if (user === null) errors.password = "Email or password is incorrect.";
  }
  if (user === null || Object.keys(errors).length > 0) throw validationError(errors);

  const token = await createSession(user.id);
  const org = await organisationOf(user.organisation_id);
  ctx.res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/" });
  ctx.res.json({ user: serialiseUser(user, org) });
}

async function organisationOf(orgId: string | null): Promise<{ id: string; name: string; kind: string } | null> {
  if (!orgId) return null;
  const { rows } = await query<{ id: string; name: string; kind: string }>(
    `SELECT id, name, kind FROM organisations WHERE id = $1`,
    [orgId],
  );
  return rows[0] ?? null;
}

export async function signOut(ctx: Ctx | PublicCtx): Promise<void> {
  const cookies = ctx.req.headers.cookie ?? "";
  const token = cookies
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
    ?.split("=")[1];
  if (token) await destroySession(decodeURIComponent(token));
  ctx.res.clearCookie(SESSION_COOKIE, { path: "/" });
  ctx.res.status(204).end();
}

export async function getMe(ctx: Ctx): Promise<void> {
  const org = await organisationOf(ctx.user.organisation_id);
  ctx.res.json({ user: serialiseUser(ctx.user, org) });
}

export async function patchMe(ctx: Ctx): Promise<void> {
  const body = (ctx.body ?? {}) as Record<string, unknown>;
  const errors: Record<string, string> = {};
  for (const key of Object.keys(body)) {
    if (key !== "display_name") errors[key] = "This field is not accepted.";
  }
  const raw = body.display_name;
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (typeof raw !== "string" || trimmed.length === 0 || trimmed.length > 80) {
    errors.display_name = "Enter a display name of 1 to 80 characters.";
  }
  if (Object.keys(errors).length > 0) throw validationError(errors);

  await query(`UPDATE users SET display_name = $2 WHERE id = $1`, [ctx.user.id, trimmed]);
  const { rows } = await query<SessionUser>(
    `SELECT id, email, display_name, role, organisation_id, licence_number,
            to_char(date_of_birth, 'YYYY-MM-DD') AS date_of_birth FROM users WHERE id = $1`,
    [ctx.user.id],
  );
  const user = rows[0];
  if (!user) throw notFound();
  const org = await organisationOf(user.organisation_id);
  ctx.res.json({ user: serialiseUser(user, org) });
}

export const unauthenticatedError = (): Error => err(401, "unauthenticated");
