import type { PoolClient } from "pg";
import type { Db } from "./db/schema.js";
import { Errors } from "./errors.js";
import { newToken } from "./identity.js";
import type { Role, TradeKey } from "../shared/types.js";
import { config } from "./config.js";

export type Person = { id: string; name: string; email: string; isOwner: boolean; firmId: string };

export type Membership = {
  id: string; // job_members id
  personId: string;
  jobId: string;
  role: Role;
  trade: TradeKey | null;
  name: string;
  email: string;
};

export type JobCtx = {
  db: Db;
  client: PoolClient;
  membership: Membership;
  person: Person;
  jobId: string;
  timeZone: string;
  jobStatus: "active" | "walkthrough" | "closed_out";
};

export const SESSION_COOKIE = "snaglight_session";

export async function createSession(db: Db, personId: string): Promise<string> {
  const token = newToken();
  await db.query(`INSERT INTO sessions (token, person_id) VALUES ($1, $2)`, [token, personId]);
  return token;
}

export async function personForToken(db: Db, token: string | undefined): Promise<Person | null> {
  if (token === undefined || token === "") return null;
  await db.query(`DELETE FROM sessions WHERE last_seen < now() - ($1 || ' minutes')::interval`, [String(config.sessionIdleMinutes)]);
  const q = await db.query<{ id: string; name: string; email: string; is_owner: boolean; firm_id: string }>(
    `SELECT p.id, p.name, p.email, p.is_owner, p.firm_id FROM sessions s JOIN people p ON p.id = s.person_id
     WHERE s.token = $1 AND s.last_seen > now() - ($2 || ' minutes')::interval`,
    [token, String(config.sessionIdleMinutes)],
  );
  const row = q.rows[0];
  if (row === undefined) return null;
  await db.query(`UPDATE sessions SET last_seen = now() WHERE token = $1`, [token]);
  return { id: row.id, name: row.name, email: row.email, isOwner: row.is_owner, firmId: row.firm_id };
}

export async function endSession(db: Db, token: string): Promise<void> {
  await db.query(`DELETE FROM sessions WHERE token = $1`, [token]);
}

export async function endOtherSessions(db: Db, personId: string, keepToken: string): Promise<void> {
  await db.query(`DELETE FROM sessions WHERE person_id = $1 AND token <> $2`, [personId, keepToken]);
}

/** The caller's active membership on a job of their own firm. */
export async function activeMembership(client: PoolClient, jobId: string, person: Person): Promise<Membership | null> {
  const res = await client.query<{ id: string; person_id: string; job_id: string; role: Role; trade: TradeKey | null; name: string; email: string }>(
    `SELECT m.id, m.person_id, m.job_id, m.role, m.trade, p.name, p.email
     FROM job_members m
     JOIN jobs j ON j.id = m.job_id AND j.firm_id = $3
     JOIN people p ON p.id = m.person_id
     WHERE m.job_id = $1 AND m.person_id = $2 AND m.ended_at IS NULL`,
    [jobId, person.id, person.firmId],
  );
  const row = res.rows[0];
  if (row === undefined) return null;
  return { id: row.id, personId: row.person_id, jobId: row.job_id, role: row.role, trade: row.trade, name: row.name, email: row.email };
}

/** Ends every visit series of a member (called when their role ends). */
async function deleteVisitsOf(client: PoolClient, jobId: string, memberId: string): Promise<void> {
  await client.query(`DELETE FROM visits WHERE job_id = $1 AND member_id = $2`, [jobId, memberId]);
}

/** Loads the job context: role_ended when the caller's only role on the job
 *  has ended (a restored role works again), 404 for a job the caller cannot
 *  see (missing, another firm's, or never held a role). */
export async function jobContext(db: Db, client: PoolClient, person: Person, jobId: string): Promise<JobCtx> {
  const job = await client.query<{ time_zone: string; status: "active" | "walkthrough" | "closed_out" }>(
    `SELECT time_zone, status FROM jobs WHERE id = $1 AND firm_id = $2`,
    [jobId, person.firmId],
  );
  const jobRow = job.rows[0];
  if (jobRow === undefined) throw Errors.notFound();
  const membership = await activeMembership(client, jobId, person);
  if (membership !== null) {
    return { db, client, membership, person, jobId, timeZone: jobRow.time_zone, jobStatus: jobRow.status };
  }
  const ended = await client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM job_members m JOIN jobs j ON j.id = m.job_id AND j.firm_id = $2
     WHERE m.job_id = $1 AND m.person_id = $3 AND m.ended_at IS NOT NULL`,
    [jobId, person.firmId, person.id],
  );
  if ((ended.rows[0]?.n ?? 0) > 0) throw Errors.roleEnded();
  throw Errors.notFound();
}

export async function endRole(client: PoolClient, jobId: string, memberId: string): Promise<void> {
  await client.query(`UPDATE job_members SET ended_at = now() WHERE id = $1`, [memberId]);
  await deleteVisitsOf(client, jobId, memberId);
}

export function requireRole(ctx: JobCtx, roles: Role[]): void {
  if (!roles.includes(ctx.membership.role)) throw Errors.forbidden();
}

export function isCrew(ctx: JobCtx): boolean {
  return ctx.membership.role === "owner" || ctx.membership.role === "lead";
}

/** The owner may use every control; on a closed job every write is refused. */
export function assertJobOpen(ctx: JobCtx): void {
  if (ctx.jobStatus === "closed_out") throw Errors.jobClosed();
}
