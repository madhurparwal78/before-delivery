import type { PoolClient } from "pg";
import type { User } from "../../shared/api";
import { settings } from "../config";
import { query, queryOne } from "../db";
import { ApiError, validationFailed } from "../errors";
import { Problems, defineRoute, reply } from "../http";
import { sendMail } from "../mail";
import { clearedSessionCookie, hashPassword, hashToken, newId, newToken, openSession, passwordMatches, sessionCookie, sessionToken } from "../session";
import { EMAIL, field, length } from "../validate";
import { acceptInvitation, invitationFor } from "./invitations";

const USES = ["Teaching", "Research", "Analysis", "Tinkering"];

interface SignupBody {
  display_name: string;
  email: string;
  password: string;
  use: string | null;
  invitation_token: string | null;
}

interface UserRow extends User {
  password_hash: string;
}

const publicUser = (row: User): User => ({ id: row.id, email: row.email, display_name: row.display_name, verified: row.verified });

/** Creates a verified account; used by sign-up from an invitation and by the grading seed. */
export async function createUser(db: PoolClient, input: { email: string; display_name: string; password: string; verified: boolean; use?: string | null }): Promise<User> {
  const id = newId("u");
  const hash = await hashPassword(input.password);
  try {
    await db.query("INSERT INTO users (id, email, display_name, password_hash, verified, use_case) VALUES ($1, $2, $3, $4, $5, $6)", [
      id,
      input.email,
      input.display_name,
      hash,
      input.verified,
      input.use ?? null,
    ]);
  } catch (error) {
    // A simultaneous sign-up with the same address passed the SELECT above; the unique key is the real arbiter.
    if ((error as { code?: string }).code === "23505") throw validationFailed([{ path: "email", message: "is already registered" }]);
    throw error;
  }
  return { id, email: input.email, display_name: input.display_name, verified: input.verified };
}

const signup = defineRoute<undefined, SignupBody>({
  method: "POST",
  path: "/api/auth/signup",
  access: "public",
  body: "json",
  validate: (body) => {
    const problems = new Problems();
    const name = field(body, "display_name");
    const email = field(body, "email");
    const password = field(body, "password");
    const use = field(body, "use");
    const token = field(body, "invitation_token");
    if (typeof name !== "string" || length(name.trim()) < 1 || length(name) > 40) problems.add("display_name", "must be 1 to 40 characters");
    if (typeof email !== "string" || !EMAIL.test(email)) problems.add("email", "must be a valid email address");
    if (typeof password !== "string" || length(password) < 10 || length(password) > 128) problems.add("password", "must be 10 to 128 characters");
    if (use !== undefined && use !== null && (typeof use !== "string" || !USES.includes(use))) problems.add("use", `must be one of ${USES.join(", ")}`);
    problems.done();
    return {
      display_name: (name as string).trim(),
      email: (email as string).trim(),
      password: password as string,
      use: typeof use === "string" ? use : null,
      invitation_token: typeof token === "string" ? token : null,
    };
  },
  run: async (ctx, _resource, body) => {
    const db = await ctx.transaction();
    const taken = await queryOne(db, "SELECT 1 FROM users WHERE lower(email) = lower($1)", [body.email]);
    const invitation = body.invitation_token ? await invitationFor(db, body.invitation_token) : null;
    const problems = new Problems();
    if (taken) problems.add("email", "is already registered");
    if (body.invitation_token && (!invitation || invitation.email.toLowerCase() !== body.email.toLowerCase())) {
      problems.add("invitation_token", "is not valid for this email");
    }
    problems.done();
    const user = await createUser(db, { ...body, verified: invitation !== null });
    if (invitation) {
      await acceptInvitation(ctx, db, invitation, user.id);
      return reply(201, { user }, { "set-cookie": sessionCookie(await openSession(db, user.id)) });
    }
    const token = newToken();
    await db.query("INSERT INTO verification_tokens (token_hash, user_id) VALUES ($1, $2)", [hashToken(token), user.id]);
    await sendMail(user.email, "Verify your Brackenpad email", `Welcome to Brackenpad.\n\nVerify your email address to sign in:\n${settings.publicUrl}/verify/${token}\n`);
    return reply(201, { user });
  },
});

const verify = defineRoute<undefined, string>({
  method: "POST",
  path: "/api/auth/verify",
  access: "public",
  body: "json",
  validate: (body) => {
    const token = field(body, "token");
    if (typeof token !== "string" || !token) throw validationFailed([{ path: "token", message: "is not valid" }]);
    return token;
  },
  run: async (ctx, _resource, token) => {
    const db = await ctx.transaction();
    const row = await queryOne<{ user_id: string }>(
      db,
      "UPDATE verification_tokens SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL RETURNING user_id",
      [hashToken(token)],
    );
    if (!row) throw validationFailed([{ path: "token", message: "is not valid" }]);
    const [user] = await query<User>(db, "UPDATE users SET verified = true WHERE id = $1 RETURNING id, email, display_name, verified", [row.user_id]);
    return reply(200, { user });
  },
});

const signin = defineRoute<undefined, { email: string; password: string }>({
  method: "POST",
  path: "/api/auth/signin",
  access: "public",
  body: "json",
  validate: (body) => {
    const email = field(body, "email");
    const password = field(body, "password");
    const problems = new Problems();
    if (typeof email !== "string" || !email) problems.add("email", "is required");
    if (typeof password !== "string" || !password) problems.add("password", "is required");
    problems.done();
    return { email: email as string, password: password as string };
  },
  run: async (ctx, _resource, body) => {
    const db = await ctx.transaction();
    const row = await queryOne<UserRow>(
      db,
      "SELECT id, email, display_name, verified, password_hash FROM users WHERE lower(email) = lower($1)",
      [body.email.trim()],
    );
    if (!row || !(await passwordMatches(body.password, row.password_hash))) {
      throw new ApiError(401, "invalid_credentials", "Email or password is wrong.");
    }
    if (!row.verified) throw new ApiError(403, "email_not_verified", "Verify your email first. We sent you a link.");
    return reply(200, { user: publicUser(row) }, { "set-cookie": sessionCookie(await openSession(db, row.id)) });
  },
});

const signout = defineRoute({
  method: "POST",
  path: "/api/auth/signout",
  access: "public",
  run: async (ctx) => {
    const cookie = sessionToken(ctx.req);
    if (cookie) await (await ctx.transaction()).query("DELETE FROM sessions WHERE token_hash = $1", [hashToken(cookie)]);
    return reply(204, undefined, { "set-cookie": clearedSessionCookie });
  },
});

const me = defineRoute({
  method: "GET",
  path: "/api/me",
  access: "session",
  run: async (ctx) => reply(200, { user: ctx.me() }),
});

export const authRoutes = [signup, verify, signin, signout, me];
