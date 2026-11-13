import type { PoolClient } from "pg";
import {
  pool,
  all,
  one,
  transaction,
  advisory,
  id,
  now,
  saveGrant,
  audit,
  auditHash,
  enqueueMail,
  staffName,
  ZERO_HASH,
} from "./db.js";
import {
  fail,
  notFound,
  validation,
  str,
  requireVersion,
  checkVersion,
} from "./errors.js";
import { requireRole } from "./auth.js";
import { voidLapsedSignoffs } from "./content.js";
import { grantActive, normalizeEmail } from "./domain.js";
import type { Grant, Role, AuditEntry, Job, Staff } from "./types.js";
import type { ApiContext, ApiResult } from "./content.js";
export const grantShape = (g: Grant): Grant => ({
  ...g,
  status: g.revoked_at ? "revoked" : grantActive(g) ? "active" : "expired",
});
const london = (instant: string): string =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .format(new Date(instant))
    .replace(" at", ",");
// Queues the one expiry notice a grant gets once its expiry is within seven days.
export async function queueGrantExpiry(
  db: PoolClient,
  g: Grant,
): Promise<void> {
  if (!grantActive(g) || Date.parse(g.expires_at) - Date.now() > 604800000)
    return;
  const claimed = await db.query(
    "UPDATE grants SET expiry_notified=true WHERE id=$1 AND expiry_notified=false RETURNING id",
    [g.id],
  );
  if (!claimed.rowCount) return;
  const role = g.role[0].toUpperCase() + g.role.slice(1);
  await enqueueMail(
    db,
    { name: await staffName(db, g.staff_email), email: g.staff_email },
    `Your ${role} access ends soon`,
    `Your ${role} access ends ${london(g.expires_at)} London.`,
  );
}
const jobColumns =
  "id::int AS id,kind,state,attempts,refusals,last_error,CASE WHEN state IN ('done','dead') THEN NULL ELSE to_char(next_attempt_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') END AS next_attempt_at,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS created_at,to_char(finished_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS finished_at";
export async function listJobs(query: URLSearchParams): Promise<Job[]> {
  return (
    await pool.query<Job>(
      `SELECT ${jobColumns} FROM jobs WHERE ($1::text IS NULL OR state=$1) AND ($2::text IS NULL OR kind=$2) ORDER BY created_at DESC,id DESC LIMIT 200`,
      [query.get("state") || null, query.get("kind") || null],
    )
  ).rows;
}
const auditColumns =
  "seq::int AS seq,id,at,actor,action,target_type,target_id,detail,prev_hash,hash";
export async function listAudit(query: URLSearchParams): Promise<AuditEntry[]> {
  const limitText = query.get("limit") ?? "100";
  const before = query.get("before_seq");
  const limit = Number(limitText);
  const fields: Record<string, string> = {};
  if (!/^\d+$/.test(limitText) || limit < 1 || limit > 500)
    fields.limit = "Choose a limit from 1 to 500.";
  if (before !== null && !/^\d+$/.test(before))
    fields.before_seq = "Choose a whole-number sequence.";
  if (Object.keys(fields).length) validation(fields);
  return (
    await pool.query<AuditEntry>(
      `SELECT ${auditColumns} FROM audit_entries WHERE ($1::text IS NULL OR action=$1) AND ($2::text IS NULL OR target_id=$2) AND ($3::bigint IS NULL OR seq<$3::bigint) ORDER BY seq DESC LIMIT $4`,
      [query.get("action"), query.get("target_id"), before, limit],
    )
  ).rows;
}
// Recomputes every hash in sequence order and reports the first entry that differs.
async function verifyChain(): Promise<Record<string, unknown>> {
  const entries = (
    await pool.query<AuditEntry>(
      `SELECT ${auditColumns} FROM audit_entries ORDER BY seq`,
    )
  ).rows;
  let prev = ZERO_HASH;
  for (const [index, entry] of entries.entries()) {
    if (
      entry.seq !== index + 1 ||
      entry.prev_hash !== prev ||
      entry.hash !== auditHash(prev, entry)
    )
      return {
        valid: false,
        entries: entries.length,
        first_invalid_seq: entry.seq,
      };
    prev = entry.hash;
  }
  return { valid: true, entries: entries.length, head: prev };
}
async function retryJob(key: string, staff: Staff): Promise<ApiResult> {
  return transaction(async (db) => {
    const job = (
      await db.query<{ state: string }>(
        "SELECT state FROM jobs WHERE id::text=$1 FOR UPDATE",
        [key],
      )
    ).rows[0];
    if (!job) notFound();
    requireRole(staff, "administrator");
    if (job.state !== "dead")
      fail(409, "job_not_dead", "Only dead jobs can be retried.");
    const retried = await db.query<Job>(
      `UPDATE jobs SET state='pending',attempts=0,refusals=0,last_error=NULL,finished_at=NULL,next_attempt_at=now() WHERE id::text=$1 RETURNING ${jobColumns}`,
      [key],
    );
    const retriedJob = retried.rows[0];
    await audit(db, staff.email, "job.retry", "job", String(retriedJob.id), {
      kind: retriedJob.kind,
    });
    return { status: 200, data: { job: retriedJob } };
  });
}
async function createGrant(
  body: Record<string, unknown>,
  actor: string,
): Promise<ApiResult> {
  return transaction(async (db) => {
    await advisory(db, "grants");
    const staff_email = normalizeEmail(str(body.staff_email)),
      role = str(body.role),
      expires_at = str(body.expires_at);
    const fields: Record<string, string> = {};
    if (
      !(await db.query("SELECT 1 FROM staff WHERE email=$1", [staff_email]))
        .rowCount
    )
      fields.staff_email = "No staff account has that email.";
    if (!["editor", "approver", "recruiter", "administrator"].includes(role))
      fields.role = "Choose editor, approver, recruiter or administrator.";
    if (
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d+)?)?Z$/.test(expires_at) ||
      !(Date.parse(expires_at) > Date.now())
    )
      fields.expires_at = "Choose an expiry in the future.";
    if (Object.keys(fields).length) validation(fields);
    if (
      (await all<Grant>(db, "grants")).some(
        (g) =>
          g.staff_email === staff_email && g.role === role && grantActive(g),
      )
    )
      fail(409, "grant_exists", "That person already holds this role.");
    const grant: Grant = {
      id: id(),
      staff_email,
      role: role as Role,
      expires_at: new Date(expires_at).toISOString(),
      granted_at: now(),
      granted_by: actor,
      revoked_at: null,
      revoked_by: null,
      version: 1,
    };
    await saveGrant(db, grant);
    await queueGrantExpiry(db, grant);
    await audit(db, actor, "grant.create", "grant", grant.id, {
      staff_email,
      role,
      expires_at: grant.expires_at,
    });
    return { status: 201, data: { grant: grantShape(grant) }, version: 1 };
  });
}
async function revokeGrant(
  key: string,
  version: string | undefined,
  staff: Staff,
): Promise<ApiResult> {
  const actor = staff.email;
  return transaction(async (db) => {
    await advisory(db, "grants");
    const g = await one<Grant>(db, "grants", key, true);
    if (!g) notFound();
    requireRole(staff, "administrator");
    const expected = requireVersion(version);
    checkVersion(expected, g.version);
    if (!grantActive(g))
      fail(409, "grant_inactive", "This grant has already ended.");
    if (
      g.role === "administrator" &&
      (await all<Grant>(db, "grants")).filter(
        (x) => x.role === "administrator" && grantActive(x),
      ).length === 1
    )
      fail(
        409,
        "last_administrator",
        "You cannot revoke the last active administrator grant.",
      );
    g.revoked_at = now();
    g.revoked_by = actor;
    g.version++;
    await saveGrant(db, g, expected);
    await audit(db, actor, "grant.revoke", "grant", g.id, {
      staff_email: g.staff_email,
      role: g.role,
    });
    if (g.role === "approver")
      await voidLapsedSignoffs(db, actor, g.staff_email);
    return { status: 200, data: { grant: grantShape(g) }, version: g.version };
  });
}
export async function governanceApi(
  ctx: ApiContext,
): Promise<ApiResult | null> {
  const { path, method, body, staff, query, version } = ctx;
  if (/^\/api\/console\/audit\/[^/]+$/.test(path) && method !== "GET")
    fail(405, "audit_immutable", "Audit entries cannot be changed or removed.");
  if (path === "/api/console/audit") {
    requireRole(staff, "administrator");
    return { status: 200, data: { entries: await listAudit(query) } };
  }
  if (path === "/api/console/audit/verify") {
    requireRole(staff, "administrator");
    return { status: 200, data: await verifyChain() };
  }
  if (path === "/api/console/jobs") {
    requireRole(staff, "administrator");
    return { status: 200, data: { jobs: await listJobs(query) } };
  }
  const retry = path.match(/^\/api\/console\/jobs\/([^/]+)\/retry$/);
  if (retry) return retryJob(retry[1], staff);
  if (path === "/api/console/grants") {
    requireRole(staff, "administrator");
    if (method === "POST") return createGrant(body, staff.email);
    return {
      status: 200,
      data: { grants: (await all<Grant>(pool, "grants")).map(grantShape) },
    };
  }
  const revoke = path.match(/^\/api\/console\/grants\/([^/]+)\/revoke$/);
  if (!revoke) return null;
  return revokeGrant(revoke[1], version, staff);
}
