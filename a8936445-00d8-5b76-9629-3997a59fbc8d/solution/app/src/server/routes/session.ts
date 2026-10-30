// Sign-in, the current session and health (brief: Session, Health).
import type { User } from "../../shared/api";
import { one, pool } from "../db";
import { ApiError } from "../errors";
import { route } from "../http";
import { passwordMatches } from "../passwords";
import { endSession, startSession } from "../sessions";

interface Credentials extends User {
  password_hash: string;
  lifecycle: string | null;
}

const userView = (u: User): User => ({ id: u.id, name: u.name, email: u.email, role: u.role, tenant_id: u.tenant_id });

export const sessionRoutes = [
  route({
    method: "GET",
    path: "/api/health",
    roles: "public",
    async handle() {
      return { status: 200, json: { status: "ok" } };
    },
  }),
  route({
    method: "POST",
    path: "/api/session",
    roles: "public",
    body: "json",
    async handle(ctx) {
      const { email, password } = ctx.json;
      const user =
        typeof email === "string"
          ? await one<Credentials>(
              pool,
              "SELECT u.*, t.lifecycle FROM users u LEFT JOIN tenants t ON t.id = u.tenant_id WHERE lower(u.email) = lower($1)",
              [email.trim()],
            )
          : undefined;
      if (!user || typeof password !== "string" || !(await passwordMatches(password, user.password_hash))) {
        throw new ApiError(401, "invalid_credentials", "That email and password don't match an account.");
      }
      if (user.lifecycle === "offboarded") throw new ApiError(403, "tenant_offboarded", "This business has been offboarded. Contact the kitchen.");
      return { status: 200, json: { user: userView(user) }, headers: { "Set-Cookie": await startSession(user.id) } };
    },
  }),
  route({
    method: "GET",
    path: "/api/session",
    roles: ["operator", "owner", "cook"],
    async handle(ctx) {
      return { status: 200, json: { user: userView(ctx.user) } };
    },
  }),
  route({
    method: "DELETE",
    path: "/api/session",
    roles: ["operator", "owner", "cook"],
    async handle(ctx) {
      return { status: 204, headers: { "Set-Cookie": await endSession(ctx.req) } };
    },
  }),
];
