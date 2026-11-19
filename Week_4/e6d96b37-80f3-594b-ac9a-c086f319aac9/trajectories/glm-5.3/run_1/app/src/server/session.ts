import type { NextFunction, Request, Response } from "express";
import type { FlanEnv } from "../shared/env.js";
import type { Role } from "../shared/types.js";
import { pool } from "./db.js";
import { randomHex } from "./util.js";
import { now as clockNow } from "./clock.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      session?: import("./session.js").Session;
    }
  }
}

export interface Session {
  sid: string;
  subject: string;
  username: string;
  role: Role;
  namespace: string;
  created_at: Date;
  expires_at: Date;
  step_up_at: Date | null;
  step_up_by_subject: string | null;
}

export const SESSION_COOKIE = "flan_session";

export async function createSession(
  env: FlanEnv,
  subject: string,
  username: string,
  role: Role,
  namespace: string,
  stepUp: boolean,
  kcSubject: string | null,
): Promise<Session> {
  const sid = randomHex(24);
  // The session lifetime runs on the namespace clock; the step-up proof on real time.
  const created = await clockNow(namespace);
  const expires = new Date(created.getTime() + env.FLAN_SESSION_TTL_S * 1000);
  const stepUpAt = stepUp ? new Date(Date.now()) : null;
  await pool.query(
    `INSERT INTO sessions (sid, subject, username, role, namespace, created_at, expires_at, step_up_at, step_up_by_subject)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [sid, subject, username, role, namespace, created, expires, stepUpAt, kcSubject ?? subject],
  );
  return {
    sid,
    subject,
    username,
    role,
    namespace,
    created_at: created,
    expires_at: expires,
    step_up_at: stepUpAt,
    step_up_by_subject: kcSubject ?? subject,
  };
}

interface SessionRow {
  sid: string;
  subject: string;
  username: string;
  role: string;
  namespace: string;
  created_at: Date;
  expires_at: Date;
  step_up_at: Date | null;
  step_up_by_subject: string | null;
}

export async function getSession(sid: string | undefined): Promise<Session | null> {
  if (!sid) return null;
  const res = await pool.query<SessionRow>(
    "SELECT sid, subject, username, role, namespace, created_at, expires_at, step_up_at, step_up_by_subject FROM sessions WHERE sid = $1",
    [sid],
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    sid: row.sid,
    subject: row.subject,
    username: row.username,
    role: row.role as Role,
    namespace: row.namespace,
    created_at: new Date(row.created_at),
    expires_at: new Date(row.expires_at),
    step_up_at: row.step_up_at ? new Date(row.step_up_at) : null,
    step_up_by_subject: row.step_up_by_subject,
  };
}

/** Sessions live on the namespace clock, so liveness compares against it. */
export async function sessionAlive(session: Session): Promise<boolean> {
  const clock = await clockNow(session.namespace);
  return session.expires_at.getTime() > clock.getTime();
}

export async function clearStepUp(sid: string): Promise<void> {
  await pool.query("UPDATE sessions SET step_up_at = NULL, step_up_by_subject = NULL WHERE sid = $1", [sid]);
}

export async function endSessionsForUser(namespace: string, username: string): Promise<void> {
  await pool.query("DELETE FROM sessions WHERE namespace = $1 AND username = $2", [namespace, username]);
}

/** Step-up freshness runs on real time, per the brief. */
export function stepUpFresh(session: Session, env: FlanEnv): boolean {
  if (session.step_up_at === null) return false;
  return Date.now() - session.step_up_at.getTime() <= env.FLAN_STEPUP_TTL_S * 1000;
}

export async function attachSession(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const cookieHeader = req.headers.cookie ?? "";
  const sid = parseCookie(cookieHeader, SESSION_COOKIE);
  const session = await getSession(sid);
  if (session && (await sessionAlive(session))) {
    req.session = session;
  }
  next();
}

function parseCookie(header: string, name: string): string | undefined {
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    if (trimmed.slice(0, eq) === name) {
      return decodeURIComponent(trimmed.slice(eq + 1));
    }
  }
  return undefined;
}
