import { config } from "../config";
import { first } from "../db/pool";
import { inUnit } from "../db/unit";
import { isUnlocked } from "../domain/unlock";
import { invalidFields, refuse } from "../http/fail";
import { defineRoute, requireJsonObject, type Handler, type Reply } from "../http/route";
import { closeSession, openSession, sessionCookie } from "../http/session";
import { checkPassword, digest, hashPassword, newToken } from "../services/passwords";
import { confirmShape, forgotShape, joinShape, parseShape, resetShape, signInShape } from "../../shared/rules";
import type { Role } from "../../shared/reference";
import type { SessionUser } from "../../shared/api";

type UserRow = { id: string; display_name: string; role: Role; unlocked: boolean; password_hash: string };

const sessionUser = (user: UserRow): SessionUser => ({
  id: user.id,
  display_name: user.display_name,
  role: user.role,
  unlocked: isUnlocked(user),
});

async function signedIn(user: UserRow, status: number): Promise<Reply> {
  const session = await openSession(user.id);
  return { status, body: { user: sessionUser(user) }, headers: { "Set-Cookie": session.cookie } };
}

const userByEmail = (email: string) =>
  first<UserRow>("SELECT id, display_name, role, unlocked, password_hash FROM users WHERE lower(email) = lower($1)", [email]);

function linkMail(path: string, token: string): string {
  return `${config.publicUrl}${path}?token=${token}`;
}

const signIn = defineRoute({
  method: "POST",
  path: "/api/auth/sign-in",
  auth: "public",
  body: "json",
  input: (ctx) => {
    const parsed = parseShape(signInShape, requireJsonObject(ctx));
    if (!parsed.ok) throw invalidFields(parsed.fields);
    return parsed.value;
  },
  async run(_ctx, _loaded, input) {
    const user = await userByEmail(input.email);
    const valid = await checkPassword(input.password, user?.password_hash);
    if (!user || !valid) throw refuse("invalid_credentials");
    return signedIn(user, 200);
  },
});

const signOut = defineRoute({
  method: "POST",
  path: "/api/auth/sign-out",
  auth: "public",
  async run(ctx) {
    await closeSession(ctx.req);
    return { status: 204, headers: { "Set-Cookie": sessionCookie("", 0) } };
  },
});

const me = defineRoute({
  method: "GET",
  path: "/api/me",
  auth: "session",
  async run(ctx) {
    const viewer = ctx.viewer;
    if (!viewer) throw refuse("unauthenticated");
    return {
      status: 200,
      body: {
        id: viewer.id,
        display_name: viewer.displayName,
        email: viewer.email,
        role: viewer.role,
        company_slug: viewer.companySlug,
        unlocked: isUnlocked(viewer),
      },
    };
  },
});

const join = defineRoute({
  method: "POST",
  path: "/api/auth/join",
  auth: "public",
  body: "json",
  input: (ctx) => {
    const parsed = parseShape(joinShape, requireJsonObject(ctx));
    if (!parsed.ok) throw invalidFields(parsed.fields);
    return parsed.value;
  },
  async run(_ctx, _loaded, input) {
    const [passwordHash, existing] = await Promise.all([hashPassword(input.password), userByEmail(input.email)]);
    const token = newToken();
    await inUnit(async (unit) => {
      if (existing) {
        await unit.mail(
          input.email,
          "You already have a Candour Bench account",
          `There is already a Candour Bench account for this address.\n\nSign in: ${config.publicUrl}/sign-in\nForgot your password: ${config.publicUrl}/forgot-password\n`,
        );
        return;
      }
      await unit.query(
        `INSERT INTO auth_tokens (token_hash, kind, pending_name, pending_email, pending_password_hash, expires_at)
         VALUES ($1, 'join', $2, $3, $4, app_now() + make_interval(secs => $5))`,
        [digest(token), input.display_name, input.email, passwordHash, config.limits.emailLinkTtlSeconds],
      );
      await unit.mail(input.email, "Finish joining Candour Bench", `Finish joining Candour Bench: ${linkMail("/join/confirm", token)}\n`);
    });
    return { status: 202, body: { status: "check_email" } };
  },
});

const confirmJoin = defineRoute({
  method: "POST",
  path: "/api/auth/join/confirm",
  auth: "public",
  body: "json",
  input: (ctx) => {
    const parsed = parseShape(confirmShape, requireJsonObject(ctx));
    if (!parsed.ok) throw refuse("token_invalid");
    return parsed.value;
  },
  async run(_ctx, _loaded, input) {
    const user = await inUnit(async (unit) => {
      const token = await unit.first<{ pending_name: string; pending_email: string; pending_password_hash: string }>(
        `UPDATE auth_tokens SET used_at = app_now()
          WHERE token_hash = $1 AND kind = 'join' AND used_at IS NULL AND expires_at > app_now()
          RETURNING pending_name, pending_email, pending_password_hash`,
        [digest(input.token)],
      );
      if (!token) throw refuse("token_invalid");
      const created = await unit.first<UserRow>(
        `INSERT INTO users (role, display_name, email, password_hash) VALUES ('member', $1, $2, $3)
         ON CONFLICT DO NOTHING RETURNING id, display_name, role, unlocked, password_hash`,
        [token.pending_name, token.pending_email, token.pending_password_hash],
      );
      if (!created) throw refuse("token_invalid");
      return created;
    });
    return signedIn(user, 201);
  },
});

const forgot = defineRoute({
  method: "POST",
  path: "/api/auth/forgot",
  auth: "public",
  body: "json",
  input: (ctx) => {
    const parsed = parseShape(forgotShape, requireJsonObject(ctx));
    if (!parsed.ok) throw invalidFields(parsed.fields);
    return parsed.value;
  },
  async run(_ctx, _loaded, input) {
    const user = await userByEmail(input.email);
    const token = newToken();
    if (user) {
      await inUnit(async (unit) => {
        await unit.query(
          `INSERT INTO auth_tokens (token_hash, kind, user_id, expires_at)
           VALUES ($1, 'reset', $2, app_now() + make_interval(secs => $3))`,
          [digest(token), user.id, config.limits.emailLinkTtlSeconds],
        );
        await unit.mail(input.email, "Reset your Candour Bench password", `Reset your password: ${linkMail("/reset-password", token)}\n`);
      });
    } else {
      await hashPassword(token);
    }
    return { status: 202, body: { status: "sent" } };
  },
});

const reset = defineRoute({
  method: "POST",
  path: "/api/auth/reset",
  auth: "public",
  body: "json",
  input: (ctx) => {
    const parsed = parseShape(resetShape, requireJsonObject(ctx));
    if (!parsed.ok) {
      if (parsed.fields["token"]) throw refuse("token_invalid");
      throw invalidFields(parsed.fields);
    }
    return parsed.value;
  },
  async run(_ctx, _loaded, input) {
    const passwordHash = await hashPassword(input.password);
    const user = await inUnit(async (unit) => {
      const token = await unit.first<{ user_id: string }>(
        `UPDATE auth_tokens SET used_at = app_now()
          WHERE token_hash = $1 AND kind IN ('reset', 'set_password') AND used_at IS NULL AND expires_at > app_now()
          RETURNING user_id`,
        [digest(input.token)],
      );
      if (!token) throw refuse("token_invalid");
      const updated = await unit.first<UserRow>(
        `UPDATE users SET password_hash = $2 WHERE id = $1 RETURNING id, display_name, role, unlocked, password_hash`,
        [token.user_id, passwordHash],
      );
      if (!updated) throw refuse("token_invalid");
      return updated;
    });
    return signedIn(user, 200);
  },
});

export const authRoutes: Handler[] = [signIn, signOut, me, join, confirmJoin, forgot, reset];
