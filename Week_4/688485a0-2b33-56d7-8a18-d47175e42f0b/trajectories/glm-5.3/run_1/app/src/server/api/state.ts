import { Pool } from "pg";
import { readLimitsFromEnv, Limits } from "../../shared/config.js";
import { S3Client } from "../services/s3.js";
import { SmtpConfig } from "../services/smtp.js";
import { fail } from "../../shared/errors.js";

/** Everything read from the environment at start (DP-89). */
export interface Env {
  databaseUrl: string;
  s3: { endpoint: string; region: string; bucket: string; forcePathStyle: boolean; accessKeyId: string; secretAccessKey: string };
  smtp: SmtpConfig;
  publicUrl: string;
  gradingKey: string | undefined;
  limits: Limits;
  port: number;
}

export function readEnv(): Env {
  const str = (name: string): string => process.env[name] ?? "";
  const port = str("APP_PUBLIC_PORT") || str("PORT") || "4173";
  const forcePathStyle = str("S3_FORCE_PATH_STYLE") === "true";
  return {
    databaseUrl: str("DATABASE_URL"),
    s3: {
      endpoint: str("S3_ENDPOINT"),
      region: str("S3_REGION"),
      bucket: str("S3_BUCKET"),
      forcePathStyle,
      accessKeyId: str("S3_ACCESS_KEY_ID"),
      secretAccessKey: str("S3_SECRET_ACCESS_KEY"),
    },
    smtp: { host: str("SMTP_HOST"), port: Number(str("SMTP_PORT")) || 1025, from: str("MAIL_FROM") },
    publicUrl: str("APP_PUBLIC_URL"),
    gradingKey: process.env.GRADING_KEY || undefined,
    limits: readLimitsFromEnv(),
    port: Number(port) || 4173,
  };
}

export interface AppState {
  env: Env;
  db: Pool;
  s3: S3Client;
  limits: Limits;
}

export const enum Role {
  Owner = "owner",
  Editor = "editor",
  Reader = "reader",
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

/** Cookie sessions: HTTP-only, SameSite=Lax (DP-60, DP-88). */
export const SESSION_COOKIE = "jarful_session";

export function readSessionToken(req: { headers: Record<string, unknown | string[]> }): string | null {
  const cookieHeader = (req.headers as { cookie?: string }).cookie;
  if (typeof cookieHeader !== "string") return null;
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return rest.join("=");
  }
  return null;
}

export function sessionCookieHeader(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax`;
}

export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/** A person's current role in a project, read on every request (DP-63). */
export async function roleIn(state: AppState, projectId: string, userId: string): Promise<Role | null> {
  const r = await state.db.query(
    "SELECT role FROM memberships WHERE project_id = $1 AND user_id = $2",
    [projectId, userId],
  );
  return r.rows.length > 0 ? (r.rows[0].role as Role) : null;
}

/** The caller must be a member; anything else is not_found (DP-64). */
export async function requireRole(state: AppState, projectId: string, userId: string, min: Role): Promise<Role> {
  const role = await roleIn(state, projectId, userId);
  if (role === null) fail("not_found", 404);
  const order = { owner: 3, editor: 2, reader: 1 } as Record<Role, number>;
  if (order[role] < order[min]) {
    fail(min === Role.Owner ? "read_only" : "read_only", 403);
  }
  return role;
}
