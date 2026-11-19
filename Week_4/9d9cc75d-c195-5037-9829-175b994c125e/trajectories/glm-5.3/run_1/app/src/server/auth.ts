import type { FastifyReply, FastifyRequest } from "fastify";
import type { Db } from "./db.js";
import { sessionUser, type SessionUser } from "./accounts.js";

export type AppState = {
  db: Db;
  storage: import("./storage.js").Storage;
  config: import("./config.js").Config;
  loginLimiter: import("./accounts.js").RateLimiter;
  formulaLimiter: import("./accounts.js").RateLimiter;
  queryLimiter: import("./accounts.js").RateLimiter;
  started: boolean;
  clockOffset: number;
  clockFixed: number | null;
  events: { add(c: { userId: string; send: (e: string, d: string) => void }): void; remove(c: { userId: string; send: (e: string, d: string) => void }): void; emitToUser(u: string, e: string, d: string): void; emitToUsers(us: Set<string>, e: string, d: string): void };
};

declare module "fastify" {
  interface FastifyInstance {
    state: AppState;
  }
  interface FastifyRequest {
    appState: AppState;
  }
}

export type Role = "viewer" | "explorer" | "creator";

export const ROLE_RANK: Record<Role, number> = { viewer: 0, explorer: 1, creator: 2 };

export interface AuthState {
  user: SessionUser | null;
  projectRole: (projectId: string) => Promise<Role | null>;
}

/** The one published error shape. */
export function errorBody(code: string, errors?: Record<string, string>): { error: string; errors?: Record<string, string> } {
  if (errors) return { error: code, errors };
  return { error: code };
}

export async function userProjectRole(db: Db, userId: string, projectId: string): Promise<Role | null> {
  const res = await db.query("SELECT role FROM members WHERE project_id = $1 AND user_id = $2", [projectId, userId]);
  const row = res.rows[0];
  return row ? (row.role as Role) : null;
}

export async function requireUser(req: FastifyRequest): Promise<SessionUser> {
  const token = readSession(req);
  const user = await sessionUser(req.appState.db, token);
  if (!user) throw new ApiError(401, "unauthenticated");
  return user;
}

export function readSession(req: FastifyRequest): string | undefined {
  return (req as unknown as { session?: string }).session;
}

/** The app state reached from a request. */
export function reqState(req: FastifyRequest): AppState {
  return req.appState;
}

export function reqDb(req: FastifyRequest): Db {
  return req.appState.db;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public errors?: Record<string, string>,
    public headers?: Record<string, string>,
  ) {
    super(code);
  }
}

/** A member sees the project; a non-member gets exactly like a missing id. */
export async function projectRoleOr404(db: Db, userId: string, projectId: string): Promise<Role> {
  const role = await userProjectRole(db, userId, projectId);
  if (!role) throw new ApiError(404, "not_found");
  return role;
}

export function requireRole(role: Role, atLeast: Role): void {
  if (ROLE_RANK[role] < ROLE_RANK[atLeast]) {
    throw new ApiError(403, "forbidden");
  }
}
