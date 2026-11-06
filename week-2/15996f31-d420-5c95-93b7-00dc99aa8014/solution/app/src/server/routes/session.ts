import type { Grower, User } from "../../shared/api.js";
import { tenthsToNumber } from "../../shared/strength.js";
import { hashToken, newToken, SESSION_COOKIE, sessionCookie } from "../auth.js";
import { one, pool, rows } from "../db.js";
import { ApiError, forbidden, parseCookies, str, type Route } from "../http.js";
import { toRuleSet } from "../model.js";
import { verifyPassword } from "../passwords.js";

export function brokerOnly(user: User): User {
  if (user.role !== "broker") throw forbidden();
  return user;
}

export const sessionRoutes: Route[] = [
  {
    method: "POST",
    path: "/api/session",
    body: "json",
    auth: false,
    async handler({ body }) {
      const email = (str(body.email) ?? "").trim().toLowerCase();
      const password = str(body.password) ?? "";
      const found = await one<User & { password_hash: string }>(pool, "SELECT id, name, role, password_hash FROM users WHERE lower(email) = $1", [email]);
      if (!found || !(await verifyPassword(password, found.password_hash))) {
        throw new ApiError(401, "invalid_credentials", "That email and password don't match a Bloom Desk account.");
      }
      const token = newToken();
      await pool.query("INSERT INTO sessions (token_hash, user_id) VALUES ($1, $2)", [hashToken(token), found.id]);
      return { status: 200, json: { user: { id: found.id, name: found.name, role: found.role } }, headers: { "Set-Cookie": sessionCookie(token) } };
    },
  },
  {
    method: "DELETE",
    path: "/api/session",
    body: "none",
    auth: true,
    async handler({ req }) {
      const token = parseCookies(req.headers.cookie)[SESSION_COOKIE] ?? "";
      await pool.query("DELETE FROM sessions WHERE token_hash = $1", [hashToken(token)]);
      return { status: 204, headers: { "Set-Cookie": sessionCookie("", true) } };
    },
  },
  {
    method: "GET",
    path: "/api/me",
    body: "none",
    auth: true,
    async handler({ user }) {
      return { status: 200, json: { user } };
    },
  },
  {
    method: "GET",
    path: "/api/growers",
    body: "none",
    auth: true,
    async handler({ user }) {
      brokerOnly(user);
      const growers = await rows<Grower>(pool, "SELECT id, name, contact_name, email FROM users WHERE role = 'grower' ORDER BY name");
      return { status: 200, json: growers };
    },
  },
  {
    method: "GET",
    path: "/api/rule-sets",
    body: "none",
    auth: true,
    async handler({ user }) {
      brokerOnly(user);
      const found = (await rows<Parameters<typeof toRuleSet>[0]>(pool, "SELECT * FROM rule_sets ORDER BY effective_from")).map(toRuleSet);
      return {
        status: 200,
        json: found.map((rule) => ({
          id: rule.id,
          name: rule.name,
          effective_from: rule.effective_from,
          thresholds: {
            reduced: tenthsToNumber(rule.thresholds.reduced),
            standard: tenthsToNumber(rule.thresholds.standard),
            bonus: tenthsToNumber(rule.thresholds.bonus),
          },
          price_per_hive_cents: rule.prices,
          commission_bps: rule.commission_bps,
          deposit_per_hive_cents: rule.deposit_per_hive_cents,
        })),
      };
    },
  },
];
