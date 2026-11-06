import type { JobStatus, NoteAudience, Role, Trade } from "../shared/domain";
import type { PersonRow } from "./auth";
import { maybeOne, type Db, type Tx } from "./db";
import { fail } from "./errors";

// Who the caller is on a job. A job outside the caller's firm, or one where they never
// held a role, is not found; a job where their role ended answers role_ended for every
// route under it, whatever ids follow.

export interface JobRow {
  id: string;
  firm_id: string;
  name: string;
  address: string;
  time_zone: string;
  status: JobStatus;
}

export interface JobAccess {
  job: JobRow;
  person: PersonRow;
  role: Role;
  trade: Trade | null;
  memberId: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export async function jobAccess(db: Db, person: PersonRow, jobId: string): Promise<JobAccess> {
  if (!isUuid(jobId)) fail("not_found");
  const job = await maybeOne<JobRow>(
    db,
    "SELECT id, firm_id, name, address, time_zone, status FROM jobs WHERE id = $1 AND firm_id = $2",
    [jobId, person.firm_id],
  );
  if (!job) fail("not_found");
  const member = await maybeOne<{ id: string; role: Role; trade: Trade | null; ended: boolean }>(
    db,
    `SELECT id, role, trade, ended_at IS NOT NULL AS ended FROM job_members
     WHERE job_id = $1 AND person_id = $2 ORDER BY ended_at IS NULL DESC, position DESC LIMIT 1`,
    [jobId, person.id],
  );
  if (!member) fail("not_found");
  if (member.ended) fail("role_ended");
  return { job, person, role: member.role, trade: member.trade, memberId: member.id };
}

export function requireRole(access: JobAccess, ...roles: Role[]): void {
  if (!roles.includes(access.role)) fail("forbidden");
}

/** Every write under a closed-out job is refused. */
export function requireOpenJob(access: JobAccess): void {
  if (access.job.status === "closed_out") fail("job_closed");
}

/**
 * The same rule at the moment of writing: holds the job row for the rest of the transaction,
 * so a close-out cannot slip between the check and the write. Writers that go on to update the
 * job row itself (item numbering) take it exclusively, so two of them never deadlock upgrading.
 */
export async function lockOpenJob(tx: Tx, jobId: string, mode: "share" | "update" = "share"): Promise<void> {
  const lock = mode === "update" ? "FOR UPDATE" : "FOR SHARE";
  const job = await maybeOne<{ status: JobStatus }>(tx, `SELECT status FROM jobs WHERE id = $1 ${lock}`, [jobId]);
  if (!job || job.status === "closed_out") fail("job_closed");
}

/** Trade scope: a trade sees only the items of their trade; everyone else sees every item. */
export function scopeTrade(access: Pick<JobAccess, "role" | "trade">): Trade | null {
  return access.role === "trade" ? access.trade : null;
}

export function canSeeItem(access: JobAccess, itemTrade: Trade | null): boolean {
  const trade = scopeTrade(access);
  return trade === null || itemTrade === trade;
}

/** Homeowners see only notes for everyone; the crew and the item's trade also see crew notes. */
export function canSeeNote(access: Pick<JobAccess, "role">, audience: NoteAudience): boolean {
  return audience === "everyone" || access.role !== "homeowner";
}
