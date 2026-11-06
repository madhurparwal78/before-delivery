import { randomUUID } from "node:crypto";
import { hashPassword } from "../auth.ts";
import { checkChain } from "../audit.ts";
import { pool, readSnapshot } from "../db.ts";
import { conflict, FieldErrors, forbidden, inPrecedence, invalid, methodNotAllowed, notFound, type Checks } from "../errors.ts";
import type { Route } from "../http.ts";
import { may } from "../permissions.ts";
import { byName, codePoints, hasControlCharacter, isRole, type Role } from "../text.ts";
import { commitWrite } from "../write.ts";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Only an Admin may call the user and audit routes. */
function adminOnly(role: Role): Checks {
  return {
    permission() {
      if (!may.administer(role)) throw forbidden();
    },
  };
}

const audit405: Route[] = [
  ...["PUT", "PATCH", "DELETE", "POST"].flatMap((method) => ["/api/audit", "/api/audit/chain"].map((pattern) => ({ method, pattern }))),
  ...["PUT", "PATCH", "DELETE"].map((method) => ({ method, pattern: "/api/audit/:id" })),
].map(({ method, pattern }) => ({
  method,
  pattern,
  async handler() {
    await inPrecedence({
      existence() {
        throw methodNotAllowed();
      },
    });
    return null;
  },
}));

export const userRoutes: Route[] = [
  {
    method: "GET",
    pattern: "/api/users",
    async handler(ctx) {
      await inPrecedence(adminOnly(ctx.actor.role));
      const { rows } = await pool.query("select id, name, email, role from users");
      return { status: 200, body: { users: rows.sort(byName) } };
    },
  },
  {
    method: "POST",
    pattern: "/api/users",
    async handler(ctx) {
      let body: Record<string, unknown> = {};
      let name = "";
      let email = "";
      await inPrecedence({
        ...adminOnly(ctx.actor.role),
        async state() {
          body = ctx.json();
          name = typeof body.name === "string" ? body.name.trim() : "";
          email = typeof body.email === "string" ? body.email.trim() : "";
          if (email && (await pool.query("select 1 from users where lower(email) = lower($1)", [email])).rowCount) {
            throw conflict("email_exists", "That email is already in use.");
          }
        },
        validation() {
          const errors = new FieldErrors();
          if (codePoints(name) < 1 || codePoints(name) > 80 || hasControlCharacter(name)) {
            errors.add("name", "Use 1 to 80 characters without control characters.");
          }
          if (!EMAIL.test(email) || codePoints(email) > 254) errors.add("email", "Enter a valid email address.");
          if (!isRole(body.role)) errors.add("role", "Role must be Admin, Steward, Analyst or Viewer.");
          if (typeof body.password !== "string" || codePoints(body.password) < 12) errors.add("password", "Use at least 12 characters.");
          errors.throwIfAny();
        },
      });
      const passwordHash = await hashPassword(body.password as string);
      const role = body.role as Role;
      const created = await commitWrite(ctx.actor, may.administer, async ({ tx }) => {
        await inPrecedence({
          async state() {
            if ((await tx.query("select 1 from users where lower(email) = lower($1)", [email])).rowCount) {
              throw conflict("email_exists", "That email is already in use.");
            }
          },
        });
        const id = `u-${randomUUID()}`;
        await tx.query("insert into users(id, name, email, role, password_hash) values ($1, $2, $3, $4, $5)", [
          id, name, email, role, passwordHash,
        ]);
        const user = { id, name, email, role };
        return {
          audit: { action: "user.create", targetType: "user", targetId: id, before: null, after: { name, email, role } },
          result: user,
        };
      });
      return { status: 201, body: { user: created } };
    },
  },
  {
    method: "PATCH",
    pattern: "/api/users/:id",
    async handler(ctx) {
      let body: Record<string, unknown> = {};
      let hasRole = false as boolean;
      let hasPassword = false as boolean;
      await inPrecedence({
        async existence() {
          if (!(await pool.query("select id from users where id = $1", [ctx.params.id])).rows[0]) throw notFound();
        },
        ...adminOnly(ctx.actor.role),
        state() {
          body = ctx.json();
          hasRole = "role" in body;
          hasPassword = "password" in body;
          const own = ctx.params.id === ctx.actor.id;
          if (own && hasRole && !hasPassword) throw conflict("own_role", "You can't change your own role.");
          if (own && hasPassword && !hasRole) throw conflict("own_password", "You can't reset your own password here.");
        },
        validation() {
          if (hasRole === hasPassword) throw invalid({ role: "Send either a role or a password." });
          if (hasRole && !isRole(body.role)) throw invalid({ role: "Role must be Admin, Steward, Analyst or Viewer." });
          if (hasPassword && (typeof body.password !== "string" || codePoints(body.password) < 12)) {
            throw invalid({ password: "Use at least 12 characters." });
          }
        },
      });
      if (hasRole) {
        const role = body.role as Role;
        const user = await commitWrite(ctx.actor, may.administer, async ({ tx }) => {
          const before = (await tx.query("select id, name, email, role from users where id = $1", [ctx.params.id])).rows[0];
          if (before.role === role) return { audit: null, result: before };
          await tx.query("update users set role = $2 where id = $1", [ctx.params.id, role]);
          return {
            audit: { action: "user.role_change", targetType: "user", targetId: ctx.params.id, before: { role: before.role }, after: { role } },
            result: { ...before, role },
          };
        });
        return { status: 200, body: { user } };
      }
      const passwordHash = await hashPassword(body.password as string);
      const result = await commitWrite(ctx.actor, may.administer, async ({ tx }) => {
        const user = (await tx.query("update users set password_hash = $2 where id = $1 returning id, name, email, role", [
          ctx.params.id, passwordHash,
        ])).rows[0];
        const ended = (await tx.query("delete from sessions where user_id = $1", [ctx.params.id])).rowCount ?? 0;
        return {
          audit: { action: "user.password_reset", targetType: "user", targetId: ctx.params.id, before: null, after: { sessions_ended: ended } },
          result: { user, sessions_ended: ended },
        };
      });
      return { status: 200, body: result };
    },
  },
  {
    method: "GET",
    pattern: "/api/audit",
    async handler(ctx) {
      const params = ctx.url.searchParams;
      const limitText = params.get("limit");
      const limit = limitText === null ? 100 : /^\d+$/.test(limitText) ? Number(limitText) : NaN;
      const beforeText = params.get("before_seq");
      const before = beforeText === null ? null : /^\d+$/.test(beforeText) ? Number(beforeText) : NaN;
      await inPrecedence({
        ...adminOnly(ctx.actor.role),
        validation() {
          const errors = new FieldErrors();
          if (!(limit >= 1 && limit <= 500)) errors.add("limit", "Use a whole number from 1 to 500.");
          if (before !== null && !(before >= 1)) errors.add("before_seq", "Use a positive whole number.");
          errors.throwIfAny();
        },
      });
      return readSnapshot(async (tx) => {
        const { rows } = await tx.query(
          `select a.id, a.seq, a.at, a.actor_id, u.name as actor_name, a.actor_role, a.action, a.target_type, a.target_id,
                  a.before, a.after, a.prev_hash, a.hash
           from audit_log a join users u on u.id = a.actor_id
           where ($1::bigint is null or a.seq < $1) order by a.seq desc limit $2`,
          [before, limit],
        );
        const total = Number((await tx.query("select count(*) as n from audit_log")).rows[0].n);
        const last = rows[rows.length - 1];
        return {
          status: 200,
          body: {
            rows: rows.map((r) => ({
              id: r.id, seq: r.seq, at: r.at, actor: { id: r.actor_id, name: r.actor_name }, actor_role: r.actor_role,
              action: r.action, target: { type: r.target_type, id: r.target_id }, before: r.before, after: r.after,
              prev_hash: r.prev_hash, hash: r.hash,
            })),
            total,
            next_before_seq: !last || last.seq === 1 ? null : last.seq,
          },
        };
      });
    },
  },
  {
    method: "GET",
    pattern: "/api/audit/chain",
    async handler(ctx) {
      await inPrecedence(adminOnly(ctx.actor.role));
      return { status: 200, body: await readSnapshot(checkChain) };
    },
  },
  ...audit405,
];
