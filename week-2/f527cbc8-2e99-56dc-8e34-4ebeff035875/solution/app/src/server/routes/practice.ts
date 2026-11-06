// The farrier's back office: the month's figures from the ledger, the CSV ledger export job, the job list, scoped
// API tokens and the audit log (brief: API, Dashboard, Jobs, API tokens, Audit; Business rules, Ledger and
// dashboard, Jobs, API tokens).
import { audit } from "../audit.js";
import { issueToken } from "../auth.js";
import { db, first, transaction } from "../db.js";
import { type LedgerKind, FIGURE_OF } from "../domain/ledger.js";
import { lastVisitDateSql, nextDue } from "../domain/nextDue.js";
import { FIELD_COPY, notFound, refuseInvalid, validation } from "../errors.js";
import { json, route } from "../http.js";
import { type JobRow, enqueueJob, jobJson, registerJob, retryJob } from "../jobs.js";
import { businessDateOf, stamp, today, zone } from "../practice.js";
import { wallClockInstant } from "../practiceTime.js";
import { type Signer, signer } from "../signedPaths.js";
import { putObject } from "../storage.js";
import { plainDollars } from "../../shared/money.js";
import { isBlank, objectBody } from "./input.js";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** The month's bounds as instants: midnight on its first day to midnight on the next month's, in the practice zone. */
function monthBounds(month: string): { from: Date; to: Date } {
  const [year = 0, mon = 1] = month.split("-").map(Number);
  const next = mon === 12 ? `${year + 1}-01` : `${year}-${String(mon + 1).padStart(2, "0")}`;
  const start = (m: string): Date => new Date(wallClockInstant(`${m}-01`, "00:00", zone()) ?? 0);
  return { from: start(month), to: start(next) };
}

interface Entry {
  kind: LedgerKind;
  amount_cents: number;
  at: Date;
  owner_name: string;
  horse_name: string;
}

async function monthEntries(month: string): Promise<Entry[]> {
  const { from, to } = monthBounds(month);
  const { rows } = await db.query<Entry>(
    `SELECT e.kind, e.amount_cents, e.at, u.name AS owner_name, h.name AS horse_name
       FROM ledger_entries e JOIN users u ON u.id = e.owner_id JOIN horses h ON h.id = e.horse_id
      WHERE e.at >= $1 AND e.at < $2 ORDER BY e.at, e.id`,
    [from, to],
  );
  return rows;
}

function monthParam(value: string | null, at: number): string {
  if (value === null) return today(at).slice(0, 7);
  if (!MONTH.test(value)) throw validation({ month: "Pick a month as YYYY-MM." });
  return value;
}

route("GET", "/api/dashboard", ["farrier"], async ({ query, now }) => {
  const month = monthParam(query.get("month"), now);
  const entries = await monthEntries(month);
  const days = new Map<string, { date: string; billed_cents: number; collected_cents: number; refunded_cents: number }>();
  const totals = { billed_cents: 0, collected_cents: 0, refunded_cents: 0 };
  for (const entry of entries) {
    const figure = FIGURE_OF[entry.kind];
    if (!figure) continue;
    const date = businessDateOf(entry.at);
    const day = days.get(date) ?? { date, billed_cents: 0, collected_cents: 0, refunded_cents: 0 };
    day[`${figure}_cents`] += entry.amount_cents;
    totals[`${figure}_cents`] += entry.amount_cents;
    days.set(date, day);
  }
  const outstanding = first(
    (
      await db.query<{ cents: number }>(
        `SELECT coalesce(sum(balance_cents), 0)::bigint AS cents FROM invoices WHERE status = 'unpaid' AND to_char(business_date, 'YYYY-MM') = $1`,
        [month],
      )
    ).rows,
  ).cents;
  const { rows: horses } = await db.query<{ cycle_weeks: number; last: string | null }>(
    `SELECT h.cycle_weeks, ${lastVisitDateSql("h.id")} AS last FROM horses h`,
  );
  const overdue = horses.filter((horse) => {
    const due = nextDue(horse.last, horse.cycle_weeks, today(now));
    return due.due_status === "overdue" && due.next_due_date?.startsWith(month);
  }).length;
  return json(200, {
    month,
    ...totals,
    outstanding_cents: outstanding,
    overdue_horses: overdue,
    rows: [...days.values()].sort((a, b) => (a.date < b.date ? -1 : 1)),
  });
});

route("POST", "/api/dashboard/exports", ["farrier"], async ({ body }) => {
  const month = objectBody(body).month;
  if (typeof month !== "string" || !MONTH.test(month)) refuseInvalid({ month: "Pick a month as YYYY-MM." });
  const jobId = await enqueueJob(db, { kind: "csv_export", payload: { month: String(month) } });
  return json(202, { job_id: jobId });
});

/** A spreadsheet must never run a cell: text starting with =, +, - or @ gets a leading quote (kit/modules/csv_safe). */
function csvCell(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

registerJob("csv_export", {
  run: async (job) => {
    const month = job.payload.month ?? "";
    const lines = [["date", "kind", "owner", "horse", "amount"]];
    for (const entry of await monthEntries(month)) {
      lines.push([businessDateOf(entry.at), entry.kind, entry.owner_name, entry.horse_name, plainDollars(entry.amount_cents)]);
    }
    const key = `exports/${month}/${job.id}.csv`;
    await putObject(key, Buffer.from(lines.map((line) => line.map(csvCell).join(",")).join("\r\n") + "\r\n", "utf8"), "text/csv; charset=utf-8");
    return { key };
  },
});

// ---- Jobs (farrier, session only) ----

/** An export's result carries a fresh same-origin download path each time it is read. */
function jobView(job: JobRow, sign: Signer): Record<string, unknown> {
  let result = job.result;
  if (job.kind === "csv_export" && job.status === "succeeded" && result) {
    const signed = sign("csv", job.id);
    result = { key: result.key, url: signed.url, url_expires_at: stamp(signed.expiresAt) };
  }
  // A due reminder names its horse and next-due date from the moment it is queued (brief: Business rules, Jobs).
  if (job.kind === "due_reminder") result = { horse_id: job.payload.horse_id, next_due_date: job.payload.next_due_date };
  else if (job.kind !== "csv_export" && job.kind !== "thumbnail") result = null;
  return jobJson(job, result, stamp);
}

route("GET", "/api/jobs", ["farrier"], async ({ query, now }) => {
  const filters: Array<[string, string]> = [];
  for (const key of ["status", "kind"] as const) {
    const value = query.get(key);
    if (value) filters.push([key, value]);
  }
  const where = filters.length ? `WHERE ${filters.map(([key], i) => `${key} = $${i + 1}`).join(" AND ")}` : "";
  const { rows } = await db.query<JobRow>(
    `SELECT * FROM jobs ${where} ORDER BY created_at DESC LIMIT 200`,
    filters.map(([, value]) => value),
  );
  const sign = await signer(db, now);
  return json(200, rows.map((job) => jobView(job, sign)));
}, { token: "never" });

route("GET", "/api/jobs/:id", ["farrier"], async ({ params, now }) => {
  const { rows } = await db.query<JobRow>(`SELECT * FROM jobs WHERE id = $1`, [params.id]);
  if (!rows[0]) throw notFound();
  return json(200, jobView(rows[0], await signer(db, now)));
}, { token: "never" });

route("POST", "/api/jobs/:id/retry", ["farrier"], async ({ params, now }) => {
  const job = await transaction(async (client) => {
    const found = await client.query(`SELECT 1 FROM jobs WHERE id = $1`, [params.id]);
    if (!found.rowCount) throw notFound();
    await retryJob(client, params.id ?? "");
    return first((await client.query<JobRow>(`SELECT * FROM jobs WHERE id = $1`, [params.id])).rows);
  });
  return json(200, jobView(job, await signer(db, now)));
});

// ---- API tokens (farrier, session only) ----

route("POST", "/api/tokens", ["farrier"], async ({ caller, body }) => {
  const fields = objectBody(body);
  const name = typeof fields.name === "string" ? fields.name.trim() : "";
  const errors: Record<string, string> = {};
  if (isBlank(fields.name)) errors.name = FIELD_COPY.required;
  else if (name.length > 80) errors.name = "Keep the name to 80 characters or fewer.";
  if (fields.scope !== "read_only" && fields.scope !== "billing") errors.scope = "Choose Read only or Billing.";
  refuseInvalid(errors);
  const scope = fields.scope as "read_only" | "billing";
  const made = await transaction(async (client) => {
    const issued = await issueToken(client, caller.id, name, scope);
    await audit(client, { action: "create", entityType: "api_token", entityId: issued.id, from: null, to: "active" });
    return issued;
  });
  return json(201, { id: made.id, name, scope, token: made.token, created_at: stamp(made.createdAt) });
});

route("GET", "/api/tokens", ["farrier"], async () => {
  const { rows } = await db.query<{ id: string; name: string; scope: string; created_at: Date }>(
    `SELECT id, name, scope, created_at FROM api_tokens WHERE revoked_at IS NULL ORDER BY created_at DESC`,
  );
  return json(200, rows.map((row) => ({ id: row.id, name: row.name, scope: row.scope, created_at: stamp(row.created_at) })));
}, { token: "never" });

route("DELETE", "/api/tokens/:id", ["farrier"], async ({ params, now }) => {
  await transaction(async (client) => {
    const revoked = await client.query(`UPDATE api_tokens SET revoked_at = $2 WHERE id = $1 AND revoked_at IS NULL`, [params.id, new Date(now)]);
    if (!revoked.rowCount) throw notFound();
    await audit(client, { action: "revoke", entityType: "api_token", entityId: params.id ?? "", from: "active", to: "revoked" });
  });
  return { status: 204 };
});

// ---- Audit (farrier, session only) ----

const ENTITY_TYPES = ["barn_day", "booking", "visit", "invoice", "payment", "vet_link", "price_list", "api_token", "import", "dunning"];

route("GET", "/api/audit", ["farrier"], async ({ query }) => {
  const filters: string[] = [];
  const values: unknown[] = [];
  const type = query.get("entity_type");
  const id = query.get("entity_id");
  const limitText = query.get("limit");
  const limit = limitText === null ? 100 : Number(limitText);
  const errors: Record<string, string> = {};
  if (type !== null && !ENTITY_TYPES.includes(type)) errors.entity_type = FIELD_COPY.required;
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) errors.limit = FIELD_COPY.range(1, 500);
  refuseInvalid(errors);
  if (type) {
    values.push(type);
    filters.push(`entity_type = $${values.length}`);
  }
  if (id) {
    values.push(id);
    filters.push(`entity_id = $${values.length}`);
  }
  values.push(limit);
  const { rows } = await db.query<{
    id: number;
    at: Date;
    actor_type: string;
    actor_id: string | null;
    action: string;
    entity_type: string;
    entity_id: string;
    from_state: string | null;
    to_state: string | null;
    request_id: string | null;
  }>(`SELECT * FROM audit_log ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""} ORDER BY at DESC, id DESC LIMIT $${values.length}`, values);
  return json(
    200,
    rows.map((row) => ({
      id: String(row.id),
      at: stamp(row.at),
      actor: { type: row.actor_type, id: row.actor_id },
      action: row.action,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      from: row.from_state,
      to: row.to_state,
      request_id: row.request_id,
    })),
  );
}, { token: "never" });
