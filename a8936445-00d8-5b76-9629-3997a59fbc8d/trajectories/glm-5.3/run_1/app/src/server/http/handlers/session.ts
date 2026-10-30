/** Session sign-in, current session and sign-out. */

import { randomBytes } from "node:crypto";
import { sessionTokenHash, verifyPassword } from "../../db.js";
import { err } from "../errors.js";
import type { App } from "../server.js";
import { json, readJson, requireUser, userJson, noContent } from "./helpers.js";

export function registerSessionRoutes(app: App): void {
  app.route("POST", "/api/session", "public", async ({ ctx, db }) => {
    const body = await readJson(ctx);
    const email = typeof body["email"] === "string" ? body["email"] : "";
    const password = typeof body["password"] === "string" ? body["password"] : "";
    const rows = await db.query<{
      id: string;
      email: string;
      name: string;
      role: "operator" | "owner" | "cook";
      tenant_id: string | null;
      password_hash: string;
      status: string | null;
    }>(
      `SELECT u.id, u.email, u.name, u.role, u.tenant_id, u.password_hash, t.status
       FROM users u LEFT JOIN tenants t ON t.id = u.tenant_id WHERE lower(u.email) = lower($1)`,
      [email]
    );
    if (rows.length === 0 || !verifyPassword(password, rows[0].password_hash)) {
      throw err(401, "invalid_credentials", "That email and password don't match an account.");
    }
    if (rows[0].status === "offboarded") {
      throw err(403, "tenant_offboarded", "This business has been offboarded. Contact the kitchen.");
    }
    const user = rows[0];
    const token = randomBytes(32).toString("base64url");
    await db.query(
      "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES ($1,$2, now(), now() + interval '30 days')",
      [sessionTokenHash(token), user.id]
    );
    await db.audit(user.id, "sign_in", "session", user.id, {});
    ctx.res.setHeader(
      "Set-Cookie",
      `sk_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 24 * 3600}`
    );
    return json(200, {
      user: userJson({ id: user.id, email: user.email, name: user.name, role: user.role, tenant_id: user.tenant_id })
    });
  });

  app.route("GET", "/api/session", "signed_in", async (rc) => {
    const user = await requireUser(rc);
    return json(200, { user: userJson(user) });
  });

  app.route("DELETE", "/api/session", "signed_in", async ({ ctx, db }) => {
    const token = ctx.cookies["sk_session"];
    if (token) {
      await db.query("DELETE FROM sessions WHERE token_hash = $1", [sessionTokenHash(token)]);
    }
    ctx.res.setHeader("Set-Cookie", "sk_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
    return noContent();
  });
}
