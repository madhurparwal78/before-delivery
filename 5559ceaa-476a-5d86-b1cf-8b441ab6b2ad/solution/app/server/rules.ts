import type pg from "pg";
import { many, one } from "./db.js";
import { ApiError, invalid } from "./errors.js";

import { type SessionAction, type SessionState, TRANSITIONS, writeRefusal } from "../shared/rules.js";
import type { SessionRow } from "./views.js";

export type { SessionAction, SessionState };

/** The session state machine: the target state for an action, or illegal_transition. */
export function transition(state: SessionState, action: SessionAction): SessionState {
  const rule = TRANSITIONS[action];
  if (!rule.from.includes(state)) throw new ApiError("illegal_transition", { from: state, to: rule.to });
  return rule.to;
}


/**
 * The baton rule: a claim or pass for `target` succeeds only on a live session at the stored version.
 * Order: session_not_live, already_driving, baton_taken (a whole-number version other than the stored one),
 * then validation (no whole-number version, or a pass target outside the project), since every state conflict
 * comes before 422.
 */
export async function checkBaton(
  db: pg.PoolClient,
  session: { state: SessionState; driver_id: string | null; version: number },
  target: string,
  version: unknown,
  targetIsMember: () => Promise<boolean> = async () => true,
): Promise<void> {
  if (session.state !== "live") throw new ApiError("session_not_live", { state: session.state });
  if (session.driver_id === target) throw new ApiError("already_driving");
  const wellFormed = typeof version === "number" && Number.isInteger(version);
  if (wellFormed && session.version !== version) {
    const driver = session.driver_id
      ? await one<{ name: string }>(db, "SELECT name FROM users WHERE id = $1", [session.driver_id])
      : undefined;
    throw new ApiError("baton_taken", {
      driver_id: session.driver_id,
      driver_name: driver?.name ?? null,
      version: session.version,
    });
  }
  const fields: Record<string, string> = {};
  if (!wellFormed) fields.version = "Send the session version you last saw.";
  if (!(await targetIsMember())) fields.to_user_id = "Pass the baton to the mentor or a student in this project.";
  if (Object.keys(fields).length > 0) throw invalid(fields);
}

/** Every change to a project's files or driver locks the project row first, so they apply one at a time. */
export async function lockProject(db: pg.PoolClient, projectId: string): Promise<void> {
  await db.query("SELECT 1 FROM projects WHERE id = $1 FOR UPDATE", [projectId]);
}

/** The write rule, judged under the project lock so a driver change cannot interleave with the write. */
export async function checkWrite(db: pg.PoolClient, projectId: string, userId: string): Promise<void> {
  await lockProject(db, projectId);
  const running = await one<{ state: SessionState; driver_id: string | null }>(
    db,
    "SELECT state, driver_id FROM sessions WHERE project_id = $1 AND state IN ('live', 'paused')",
    [projectId],
  );
  const refusal = writeRefusal(running ?? null, userId);
  if (refusal === "session_paused") throw new ApiError("session_paused");
  if (refusal === "not_driver") throw new ApiError("not_driver", { driver_id: running?.driver_id ?? null });
}

/**
 * The hand-back after a removal or erasure: a running session driven by `userId` is driven by the project's mentor
 * from now on, which is a driver change (version + 1). Returns the changed session, if any.
 */
export async function handBack(db: pg.PoolClient, projectId: string, userId: string): Promise<SessionRow | undefined> {
  return one<SessionRow>(
    db,
    `UPDATE sessions s SET driver_id = p.owner_id, version = s.version + 1, updated_at = now() FROM projects p
     WHERE p.id = s.project_id AND s.project_id = $1 AND s.driver_id = $2 AND s.state IN ('live', 'paused')
     RETURNING s.id, s.project_id, s.title, s.state, s.scheduled_for, s.driver_id, s.version`,
    [projectId, userId],
  );
}

/** Expiry: a thing is expired from its expiry instant onward, judged by the server clock. */
export function expired(expiresAt: Date, now: Date = new Date()): boolean {
  return now.getTime() >= expiresAt.getTime();
}

/** The sign-in landing path, decided when the token is verified. */
export async function landingFor(db: pg.PoolClient, userId: string, inviteProjectId: string | null): Promise<string> {
  if (inviteProjectId) {
    const member = await one(db, "SELECT 1 FROM memberships WHERE project_id = $1 AND user_id = $2", [inviteProjectId, userId]);
    return member ? `/projects/${inviteProjectId}` : "/";
  }
  const projects = await many<{ project_id: string }>(db, "SELECT project_id FROM memberships WHERE user_id = $1", [userId]);
  return projects.length === 1 ? `/projects/${projects[0]!.project_id}` : "/";
}
