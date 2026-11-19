import type { Request } from "express";
import { err } from "./http.js";
import { q1 } from "./db.js";

export type Session = { id: string; deskId: string; name: string; email: string; endsAt: Date };

export async function loadSession(req: Request): Promise<Session | null> {
  const cookie = req.headers.cookie ?? "";
  const m = /(?:^|;\s*)semenza_session=([^;]+)/.exec(cookie);
  if (!m) return null;
  const id = decodeURIComponent(m[1]!);
  const row = await q1<{ id: string; desk_id: string; ends_at: Date; ended_at: Date | null, name: string, email: string }>(
    `SELECT s.id, s.desk_id, s.ends_at, s.ended_at, d.name, d.email
     FROM sessions s JOIN desks d ON d.id = s.desk_id WHERE s.id = $1`,
    [id]
  );
  if (!row) return null;
  if (row.ended_at || row.ends_at.getTime() <= Date.now()) return null;
  return { id: row.id, deskId: row.desk_id, name: row.name, email: row.email, endsAt: row.ends_at };
}

export async function requireSession(req: Request): Promise<Session> {
  const cookie = req.headers.cookie ?? "";
  const has = /(?:^|;\s*)semenza_session=/.test(cookie);
  const session = await loadSession(req);
  if (session) return session;
  throw has ? err.sessionEnded() : err.notSignedIn();
}
