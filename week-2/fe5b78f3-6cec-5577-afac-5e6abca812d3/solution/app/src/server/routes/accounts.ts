// Accounts and sessions (brief: DP-06).
import { randomUUID } from "node:crypto";
import { accountErrors } from "../domain/validate.js";
import type { Route } from "../http/api.js";
import { ApiError, assertValid } from "../http/errors.js";
import { type AccountRow, endSession, owner, publicAccount, startSession } from "../http/session.js";
import { hashPassword, verifyPassword } from "../store/accounts.js";

export const accountRoutes: Route[] = [
  {
    method: "POST",
    pattern: /^\/api\/accounts$/,
    async handle(ctx, app) {
      const b = ctx.body;
      assertValid(accountErrors(b));
      const email = (b.email as string).trim().toLowerCase();
      const row: AccountRow = { id: randomUUID(), name: (b.name as string).trim(), email, phone: b.phone as string, kb_account_id: null };
      const inserted = await app.db.query(
        `INSERT INTO accounts (id, name, email, phone, password_hash) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (email) DO NOTHING RETURNING id`,
        [row.id, row.name, row.email, row.phone, await hashPassword(b.password as string)],
      );
      if (inserted.rowCount === 0) throw new ApiError(409, "email_taken", "An account already uses this email.");
      return { status: 201, body: publicAccount(row), headers: { "Set-Cookie": await startSession(app.db, row.id) } };
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/session$/,
    async handle(ctx, app) {
      const { email, password } = ctx.body;
      const { rows } = await app.db.query<AccountRow & { password_hash: string }>(
        "SELECT id, name, email, phone, kb_account_id, password_hash FROM accounts WHERE email = $1",
        [typeof email === "string" ? email.trim().toLowerCase() : ""],
      );
      const row = rows[0];
      if (!row || typeof password !== "string" || !(await verifyPassword(password, row.password_hash))) {
        throw new ApiError(401, "invalid_credentials", "Email or password is wrong.");
      }
      return { status: 200, body: publicAccount(row), headers: { "Set-Cookie": await startSession(app.db, row.id) } };
    },
  },
  {
    method: "DELETE",
    pattern: /^\/api\/session$/,
    async handle(ctx, app) {
      return { status: 204, headers: { "Set-Cookie": await endSession(app.db, ctx.req) } };
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/me$/,
    auth: true,
    async handle(ctx) {
      return { status: 200, body: publicAccount(owner(ctx)) };
    },
  },
];
