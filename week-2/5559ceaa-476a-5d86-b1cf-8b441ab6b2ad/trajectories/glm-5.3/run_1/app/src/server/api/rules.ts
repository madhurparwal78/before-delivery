import { ApiError } from "../errors.js";
import type { PoolClient } from "pg";
import type { SessionRow } from "./helpers.js";

/**
 * The single place that decides the write rule for project files.
 * A write is a file create, content save, delete, restore or restore undo.
 */
export type WriteDecision = { allowed: true; driver: boolean } | { code: "not_driver"; driver_id: string } | { code: "session_paused" };

export async function checkWrite(
  client: PoolClient,
  projectId: string,
  userId: string,
): Promise<WriteDecision> {
  const r = await client.query(
    `SELECT id, state, driver_id FROM sessions
     WHERE project_id = $1 AND state IN ('live','paused')
     ORDER BY created_at DESC LIMIT 1`,
    [projectId],
  );
  if (r.rowCount === 0) return { allowed: true, driver: true };
  const s = r.rows[0] as { state: string; driver_id: string | null };
  if (s.state === "paused") return { code: "session_paused" };
  if (s.driver_id !== userId) {
    return { code: "not_driver", driver_id: s.driver_id ?? "" };
  }
  return { allowed: true, driver: true };
}

export async function liveSession(
  client: PoolClient,
  projectId: string,
): Promise<SessionRow | null> {
  const r = await client.query(
    `SELECT id, project_id, title, state, scheduled_for, driver_id, version
     FROM sessions WHERE project_id = $1 AND state = 'live'
     ORDER BY created_at DESC LIMIT 1`,
    [projectId],
  );
  if (r.rowCount === 0) return null;
  return r.rows[0] as SessionRow;
}

export function requireAllowedWrite(d: WriteDecision): void {
  if ("code" in d && d.code === "session_paused") {
    throw new ApiError("session_paused", "The session is paused, so nobody may edit.");
  }
  if ("code" in d && d.code === "not_driver") {
    throw new ApiError("not_driver", "Only the driver may edit during a live session.", {
      driver_id: d.driver_id,
    });
  }
}

/**
 * The single place that decides legal session transitions.
 */
const TRANSITIONS: Record<string, string[]> = {
  scheduled: ["live"],
  live: ["paused", "ended"],
  paused: ["live", "ended"],
  ended: [],
};

export function transition(from: string, to: string): void {
  if (!(TRANSITIONS[from] ?? []).includes(to)) {
    throw new ApiError("illegal_transition", `Cannot move a session from ${from} to ${to}.`, {
      from,
      to,
    });
  }
}
