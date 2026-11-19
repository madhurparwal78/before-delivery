import type { Request, Response, NextFunction } from "express";
import { query } from "./db.js";
import { CrewRecord } from "./crew-record.js";
import { ShipTimeline } from "./timeline.js";
import { readCookie } from "./cookies.js";
import { toUtcString } from "../shared/time.js";

export interface SessionPerson {
  id: string;
  name: string;
  role: "owner_master" | "crew";
  vesselId: string | null;
}

declare global {
  namespace Express {
    interface Request {
      person?: SessionPerson;
    }
  }
}

export const SESSION_COOKIE = "sixbell_session";

export function serverNow(): number {
  return Date.now();
}

/** The signed-in person from the session cookie, or null. */
export async function personFromRequest(req: Request): Promise<SessionPerson | null> {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;
  const rows = await query<{ person_id: string; role: "owner_master" | "crew"; expires_at: Date }>(
    `SELECT person_id, role, expires_at FROM sessions WHERE id = $1`, [token]);
  const row = rows[0];
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= serverNow()) return null;
  if (row.role === "owner_master") {
    const owner = await query<{ name: string }>(`SELECT name FROM owners WHERE id = $1`, [row.person_id]);
    return owner[0] ? { id: row.person_id, name: owner[0].name, role: "owner_master", vesselId: null } : null;
  }
  const crew = await query<{ name: string; vessel_id: string }>(`SELECT name, vessel_id FROM crew WHERE id = $1`, [row.person_id]);
  return crew[0] ? { id: row.person_id, name: crew[0].name, role: "crew", vesselId: crew[0].vessel_id } : null;
}

export function requirePerson(req: Request, res: Response, next: NextFunction): void {
  if (!req.person) {
    res.status(401).json({ error: "not_signed_in", message: "You need to sign in first." });
    return;
  }
  next();
}

export function requireOwnerMaster(req: Request, res: Response, next: NextFunction): void {
  if (!req.person) {
    res.status(401).json({ error: "not_signed_in", message: "You need to sign in first." });
    return;
  }
  if (req.person.role !== "owner_master") {
    res.status(403).json({ error: "forbidden", message: "Only the owner-master can do that." });
    return;
  }
  next();
}

/** A crew member's record, their vessel's timeline and rule sets, for signed-in access. */
export async function crewRecordFor(crewId: string): Promise<CrewRecord | null> {
  const rows = await query<{ vessel_id: string; initial_offset_minutes: number }>(
    `SELECT c.vessel_id, v.initial_offset_minutes FROM crew c JOIN vessels v ON v.id = c.vessel_id WHERE c.id = $1`, [crewId]);
  const row = rows[0];
  if (!row) return null;
  const changes = await query<{
    id: string; vessel_id: string; changes_at_utc: string; old_offset_minutes: number;
    new_offset_minutes: number; fix_id: string | null;
  }>(
    `SELECT id, vessel_id, changes_at_utc, old_offset_minutes, new_offset_minutes, fix_id
     FROM clock_changes WHERE vessel_id = $1 ORDER BY changes_at_utc`, [row.vessel_id]);
  const ruleSets = await query<{ effective_from_utc: string; effective_until_utc: string }>(
    `SELECT effective_from_utc, effective_until_utc FROM rule_sets WHERE vessel_id = $1 ORDER BY effective_from_utc`,
    [row.vessel_id]);
  return new CrewRecord(
    crewId,
    row.vessel_id,
    new ShipTimeline(row.initial_offset_minutes, changes),
    ruleSets.map((r) => ({ from: r.effective_from_utc, until: r.effective_until_utc })),
    serverNow()
  );
}

/** A vessel's owner id, to keep records invisible across owner-masters. */
export async function vesselOwner(vesselId: string): Promise<string | null> {
  const rows = await query<{ owner_id: string }>(`SELECT owner_id FROM vessels WHERE id = $1`, [vesselId]);
  return rows[0]?.owner_id ?? null;
}

/** The today ship's date of a crew member's vessel. */
export function todayShipDate(record: CrewRecord): string {
  return record.timeline.shipDateOf(serverNow());
}

export function nowUtcString(): string {
  return toUtcString(serverNow());
}
