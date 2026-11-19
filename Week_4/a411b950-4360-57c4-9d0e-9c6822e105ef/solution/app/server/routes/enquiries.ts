import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { PoolClient } from "pg";
import { config } from "../config.js";
import { type Db, one, query, transaction } from "../db.js";
import { fail, HttpError, invalid, type Multipart, notFound, parseMultipart, sendBytes, sendJson } from "../http.js";
import { fingerprint, idempotencyKey, idempotent } from "../idempotency.js";
import { alertLetter, receiptLetter } from "../letters.js";
import { cancelProposalMail, deliverForEnquiry, type DeliveryState, PROPOSAL_MAIL_VOID, queueMail } from "../mail.js";
import { checkReference, CONTENT_TYPES, type ReferenceFormat } from "../media.js";
import { milestoneView } from "../milestones.js";
import type { Context, Route } from "../router.js";
import { getObject, putObject } from "../storage.js";
import { asObject, Checker, MONTH_KEY, nonEmpty, NOT_WRITABLE } from "../validate.js";
import { monthIsOpen } from "./months.js";
import { type EnquiryStatus, PIPELINE, TRIAGE_WRITABLE } from "../../shared/lifecycle.js";
import { liveLink } from "./journey.js";
import { PUBLIC_STATION } from "./projects.js";
import { settings } from "./session.js";


export function assertMove(from: EnquiryStatus, to: EnquiryStatus): void {
  if (!PIPELINE[from].includes(to)) {
    fail(409, "illegal_transition", "That move isn’t allowed from the current state.", { from, to });
  }
}

export interface EnquiryRow {
  id: string;
  reference_number: number;
  version: number;
  received_at: Date;
  read_status: EnquiryStatus;
  name: string;
  email: string;
  studio: string;
  brief: string;
  preferred_month: string | null;
  live_project_slug: string | null;
  attachment_filename: string | null;
  attachment_bytes: number | null;
  attachment_format: ReferenceFormat | null;
  attachment_key: string | null;
  triage_notes: string;
  fit_score: number | null;
  rate_floor_cents: number | null;
  receipt_state: DeliveryState | null;
  proposal_state: DeliveryState | null;
  month_held_state: DeliveryState | null;
  deposit_state: DeliveryState | null;
  token: string | null;
  producer_name: string | null;
  producer_email: string | null;
  project_title: string | null;
  scope: string | null;
  fee_cents: number | null;
  production_month: string | null;
  milestone_cents: number[] | null;
  expires_at: Date | null;
  killbill_account_id: string | null;
  deposit_invoice_id: string | null;
  deposit_invoice_number: string | null;
  deposit_amount_cents: number | null;
  deposit_balance_cents: number | null;
  deposit_payment_id: string | null;
  deposit_paid_at: Date | null;
  deposit_invoice_date: string | null;
  invoiced_milestones: number[];
}

const mailState = (kind: string): string =>
  `(SELECT m.state FROM outbound_mail m WHERE m.enquiry_id = e.id AND m.kind = '${kind}') AS ${kind}_state`;

/** Status at read time, decided here only: a proposal still in proposal_sent reads as expired from its expiry instant. */
const READ_STATUS = "CASE WHEN e.status = 'proposal_sent' AND pp.expires_at <= clock_timestamp() THEN 'expired' ELSE e.status END";

/** One enquiry with its proposal, its mail queue states and its live project slug (blank once withdrawn). */
const ENQUIRY_SELECT = `
  SELECT e.id, e.reference_number, e.version, e.received_at, ${READ_STATUS} AS read_status, e.name, e.email, e.studio, e.brief,
    e.preferred_month, CASE WHEN pr.status <> 'withdrawn' THEN pr.slug END AS live_project_slug,
    e.attachment_filename, e.attachment_bytes, e.attachment_format, e.attachment_key,
    e.triage_notes, e.fit_score, e.rate_floor_cents,
    ${mailState("receipt")}, ${mailState("month_held")}, ${mailState("deposit")},
    (SELECT CASE WHEN m.state = 'pending' AND ${PROPOSAL_MAIL_VOID} THEN 'cancelled' ELSE m.state END
       FROM outbound_mail m WHERE m.enquiry_id = e.id AND m.kind = 'proposal') AS proposal_state,
    pp.token, pp.producer_name, pp.producer_email, pp.project_title, pp.scope, pp.fee_cents, pp.production_month,
    pp.milestone_cents, pp.expires_at, pp.killbill_account_id, pp.deposit_invoice_id, pp.deposit_invoice_number,
    pp.deposit_amount_cents, pp.deposit_balance_cents, pp.deposit_payment_id, pp.deposit_paid_at, pp.deposit_invoice_date,
    ARRAY(SELECT mi.number FROM milestone_invoices mi WHERE mi.enquiry_id = e.id ORDER BY mi.number) AS invoiced_milestones
  FROM enquiries e
  LEFT JOIN projects pr ON pr.id = e.project_id
  LEFT JOIN proposals pp ON pp.enquiry_id = e.id`;

export const reference = (row: { reference_number: number }): string =>
  `ENQ-${String(row.reference_number).padStart(6, "0")}`;

function toEnquiry(row: EnquiryRow) {
  return {
    id: row.id,
    reference: reference(row),
    version: row.version,
    received_at: row.received_at.toISOString(),
    status: row.read_status,
    name: row.name,
    email: row.email,
    studio: row.studio,
    brief: row.brief,
    preferred_month: row.preferred_month,
    project_slug: row.live_project_slug,
    attachment: row.attachment_filename === null ? null : {
      filename: row.attachment_filename,
      bytes: row.attachment_bytes,
      url: `/api/console/enquiries/${row.id}/attachment`,
    },
    receipt: row.receipt_state,
    triage_notes: row.triage_notes,
    fit_score: row.fit_score,
    rate_floor_cents: row.rate_floor_cents,
    proposal: row.token === null ? null : {
      token: row.token,
      url: `/p/${row.token}`,
      producer_name: row.producer_name,
      producer_email: row.producer_email,
      project_title: row.project_title,
      scope: row.scope,
      fee_cents: row.fee_cents,
      production_month: row.production_month,
      milestones: milestoneView(row.milestone_cents ?? []),
      expires_at: row.expires_at?.toISOString() ?? null,
      email: row.proposal_state,
      held_email: row.month_held_state,
      deposit_email: row.deposit_state,
      invoiced_milestones: row.invoiced_milestones,
    },
  };
}

export async function enquiryRow(id: string, db?: Db, lock = false): Promise<EnquiryRow> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  if (lock) await one("SELECT id FROM enquiries WHERE id = $1 FOR UPDATE", [id], db);
  const row = await one<EnquiryRow>(`${ENQUIRY_SELECT} WHERE e.id = $1`, [id], db);
  if (!row) notFound();
  return row;
}

const etag = (version: number): string => `"${version}"`;

function sendEnquiry(res: Context["res"], status: number, row: EnquiryRow): void {
  sendJson(res, status, { enquiry: toEnquiry(row) }, { ETag: etag(row.version) });
}

/**
 * A console write from a copy at version If-Match: the enquiry is locked, the version compared, `work`
 * applied and the version raised by one, all in one transaction. Answers 428, 412 or the work's own refusal.
 */
export async function consoleWrite(
  { req, res, params }: Context,
  status: number,
  work: (client: PoolClient, row: EnquiryRow) => Promise<Record<string, unknown> | void>,
): Promise<void> {
  const id = params.id ?? "";
  const ifMatch = req.headers["if-match"];
  const extra = await transaction(async (client) => {
    const row = await enquiryRow(id, client, true);
    if (!ifMatch) fail(428, "precondition_required", "Send If-Match with the version you edited.");
    if (!ifMatch.split(",").some((tag) => tag.trim() === etag(row.version))) {
      fail(412, "stale_version", "This enquiry changed in another window.", { current: toEnquiry(row) }, { ETag: etag(row.version) });
    }
    const result = await work(client, row);
    await client.query("UPDATE enquiries SET version = version + 1 WHERE id = $1", [id]);
    return result ?? {};
  });
  await deliverForEnquiry(id);
  const updated = await enquiryRow(id);
  sendJson(res, status, { ...extra, enquiry: toEnquiry(updated) }, { ETag: etag(updated.version) });
}

// ---- Public intake ----

const BRIEF_FIELDS = ["name", "email", "studio", "brief", "preferred_month", "project_slug", "listen_token"] as const;

/** This instance's pacing policy; enquiries are counted only against instances running the same one. */
const PACING_POLICY = `${config.pacing.perSender}/${config.pacing.perIp}/${config.pacing.windowSeconds}`;

/** Pacing: one sender (lowercased email) and one IP may save at most N enquiries in the rolling window. */
async function enforcePacing(client: PoolClient, email: string, ip: string): Promise<void> {
  const { perSender, perIp, windowSeconds } = config.pacing;
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('enquiry-sender:' || $2 || ':' || lower($1), 0))", [email, PACING_POLICY]);
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('enquiry-ip:' || $2 || ':' || $1, 0))", [ip, PACING_POLICY]);
  const usage = await one<{ sender_count: number; sender_free_in: number | null; ip_count: number; ip_free_in: number | null }>(
    `WITH sender AS (
       SELECT received_at FROM enquiries WHERE pacing_policy = $6 AND lower(email) = lower($1)
         AND received_at > clock_timestamp() - make_interval(secs => $3) ORDER BY received_at DESC LIMIT $4),
     peer AS (
       SELECT received_at FROM enquiries WHERE pacing_policy = $6 AND sender_ip = $2
         AND received_at > clock_timestamp() - make_interval(secs => $3) ORDER BY received_at DESC LIMIT $5)
     SELECT (SELECT count(*)::int FROM sender) AS sender_count,
       (SELECT ceil(extract(epoch FROM min(received_at) + make_interval(secs => $3) - clock_timestamp()))::int FROM sender) AS sender_free_in,
       (SELECT count(*)::int FROM peer) AS ip_count,
       (SELECT ceil(extract(epoch FROM min(received_at) + make_interval(secs => $3) - clock_timestamp()))::int FROM peer) AS ip_free_in`,
    [email, ip, windowSeconds, perSender, perIp, PACING_POLICY],
    client,
  );
  const waits: number[] = [];
  if ((usage?.sender_count ?? 0) >= perSender) waits.push(usage?.sender_free_in ?? windowSeconds);
  if ((usage?.ip_count ?? 0) >= perIp) waits.push(usage?.ip_free_in ?? windowSeconds);
  if (waits.length > 0) {
    const retryAfter = Math.max(1, ...waits);
    fail(429, "rate_limited", "Too many briefs in a short time.", { retry_after_seconds: retryAfter }, { "Retry-After": String(retryAfter) });
  }
}

/** The project a brief was heard from: a live link's project, else a published public slug, else none. */
async function heardProject(client: PoolClient, slug: string | undefined, token: string | undefined): Promise<string | null> {
  if (token) {
    const live = await liveLink(token).catch((error: unknown) => {
      if (error instanceof HttpError && (error.status === 404 || error.status === 410)) return null;
      throw error;
    });
    if (live) return live.project.id;
  }
  if (slug) {
    const visible = await one<{ id: string }>(`SELECT p.id FROM projects p WHERE p.slug = $1 AND ${PUBLIC_STATION}`, [slug], client);
    if (visible) return visible.id;
  }
  return null;
}

/** Brief answers kept under their Idempotency-Key; 429 and 503 are judged afresh on a retry. */
const BRIEF_STORED = new Set([201, 413, 415, 422]);

async function sendBrief({ req, res, raw, ip }: Context): Promise<void> {
  const key = idempotencyKey(req, false);
  const form = parseMultipart(req.headers["content-type"], raw);
  if (!form) invalid({ body: "Send the brief as multipart form data." });
  const save = () => saveBrief(form, ip);
  if (key === null) {
    const answer = await save();
    sendJson(res, answer.status, answer.body);
    return;
  }
  const files = [...form.files].map(([name, file]) => ({
    name, filename: file.filename, sha256: createHash("sha256").update(file.data).digest("hex"),
  }));
  const print = fingerprint({ fields: Object.fromEntries(form.fields), files });
  await idempotent(res, { scope: "brief", key, fingerprint: print }, (status) => BRIEF_STORED.has(status), save);
}

async function saveBrief(form: Multipart, ip: string): Promise<{ status: number; body: unknown }> {
  const body: Record<string, unknown> = Object.fromEntries(form.fields);
  const attachment = form.files.get("attachment");
  const unexpected = [...form.files.keys()].filter((key) => key !== "attachment");
  const id = randomUUID();
  const created = await transaction(async (client) => {
    await enforcePacing(client, String(body.email ?? ""), ip);
    const format = attachment && (attachment.data.length > 0 || attachment.filename !== "")
      ? checkReference("attachment", attachment.filename, attachment.data)
      : null;
    const check = new Checker(body).writable(BRIEF_FIELDS);
    for (const key of unexpected) check.error(key, NOT_WRITABLE);
    const name = check.singleLine("name", 1, 120);
    const email = check.address("email");
    const studio = check.singleLine("studio", 1, 120);
    const brief = check.multiLine("brief", 20, 4000);
    const month = typeof body.preferred_month === "string" && body.preferred_month !== "" ? body.preferred_month : null;
    if (month !== null && (!MONTH_KEY.test(month) || !(await monthIsOpen(client, month)))) {
      check.error("preferred_month", "Choose one of the open production months.");
    }
    check.done();
    const projectId = await heardProject(
      client,
      typeof body.project_slug === "string" ? body.project_slug : undefined,
      typeof body.listen_token === "string" ? body.listen_token : undefined,
    );
    const key = format && attachment ? `briefs/${id}/${randomUUID()}.${format}` : null;
    const row = await one<{ reference_number: number }>(
      `INSERT INTO enquiries (id, reference_number, received_at, name, email, studio, brief, preferred_month, project_id,
         sender_ip, pacing_policy, attachment_filename, attachment_bytes, attachment_format, attachment_key)
       VALUES ($1, nextval('enquiry_reference_seq'), clock_timestamp(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING reference_number`,
      [id, name, email, studio, brief, month, projectId, ip, PACING_POLICY,
        key ? attachment?.filename : null, key ? attachment?.data.length : null, format, key],
      client,
    );
    if (!row) notFound();
    const enquiry = await enquiryRow(id, client);
    const director = {
      id, reference: reference(row), name, email, studio, brief, preferredMonth: month,
      projectSlug: enquiry.live_project_slug,
      attachment: key && attachment ? { filename: attachment.filename, bytes: attachment.data.length } : null,
    };
    await queueMail(client, receiptLetter(director));
    await queueMail(client, alertLetter(director, (await settings()).operator_email));
    if (key && attachment && format) await putObject(key, attachment.data, CONTENT_TYPES[format]);
    return director.reference;
  });
  const states = await deliverForEnquiry(id);
  return { status: 201, body: { reference: created, status: "new", receipt: states.get("receipt") ?? "pending" } };
}

// ---- Console ----

// ---- Paging ----

const ENQUIRY_STATUSES = Object.keys(PIPELINE) as EnquiryStatus[];
const PAGE_SIZE = 25;
const PAGE_MAX = 100;

let cursorSecret: string | undefined;

/** The cursor key every instance shares, kept in PostgreSQL. */
async function cursorKey(): Promise<string> {
  cursorSecret ??= (await one<{ secret: string }>("SELECT secret FROM server_keys WHERE name = 'enquiry-cursor'"))?.secret ?? "";
  return cursorSecret;
}

/**
 * The paging cursor, decided here only: the last row's reference number and the status filter it was read
 * under ("" when absent), signed so only a cursor this app issued is accepted.
 */
async function issueCursor(referenceNumber: number, filter: string): Promise<string> {
  const payload = `${referenceNumber}.${filter}`;
  const signature = createHmac("sha256", await cursorKey()).update(payload).digest("base64url");
  return Buffer.from(`${payload}.${signature}`).toString("base64url");
}

async function readCursor(cursor: string, filter: string): Promise<number | null> {
  const decoded = Buffer.from(cursor, "base64url");
  if (decoded.toString("base64url") !== cursor) return null;
  const [number = "", status, signature = ""] = decoded.toString().split(".");
  const expected = Buffer.from(createHmac("sha256", await cursorKey()).update(`${number}.${status ?? ""}`).digest("base64url"));
  const given = Buffer.from(signature);
  const valid = /^\d{1,12}$/.test(number) && status === filter && given.length === expected.length
    && timingSafeEqual(given, expected);
  return valid ? Number.parseInt(number, 10) : null;
}

async function listEnquiries({ res, url }: Context): Promise<void> {
  const errors: Record<string, string> = {};
  const status = url.searchParams.get("status");
  if (status !== null && !ENQUIRY_STATUSES.includes(status as EnquiryStatus)) errors.status = "Choose one of the eight enquiry statuses.";
  const rawLimit = url.searchParams.get("limit");
  const limit = rawLimit === null ? PAGE_SIZE : /^\d{1,3}$/.test(rawLimit) ? Number.parseInt(rawLimit, 10) : 0;
  if (limit < 1 || limit > PAGE_MAX) errors.limit = `Use a whole number from 1 to ${PAGE_MAX}.`;
  const rawCursor = url.searchParams.get("cursor");
  const before = rawCursor === null ? null : await readCursor(rawCursor, status ?? "");
  if (rawCursor !== null && before === null) errors.cursor = "Use a next_cursor from the same status filter.";
  if (Object.keys(errors).length > 0) invalid(errors);
  const rows = await query<EnquiryRow>(
    `SELECT * FROM (${ENQUIRY_SELECT}) q
     WHERE ($1::text IS NULL OR q.read_status = $1) AND ($2::bigint IS NULL OR q.reference_number < $2)
     ORDER BY q.reference_number DESC LIMIT $3`,
    [status, before, limit + 1],
  );
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  sendJson(res, 200, {
    enquiries: page.map(toEnquiry),
    next_cursor: rows.length > limit && last ? await issueCursor(last.reference_number, status ?? "") : null,
  });
}

async function getEnquiry({ res, params }: Context): Promise<void> {
  sendEnquiry(res, 200, await enquiryRow(params.id ?? ""));
}

async function getAttachment({ res, params }: Context): Promise<void> {
  const row = await enquiryRow(params.id ?? "");
  if (!row.attachment_key || !row.attachment_format) notFound();
  const bytes = await getObject(row.attachment_key);
  if (!bytes) notFound();
  sendBytes(res, CONTENT_TYPES[row.attachment_format], bytes, {
    "Content-Disposition": `attachment; filename="${reference(row)}.${row.attachment_format}"`,
  });
}

async function saveTriage(context: Context): Promise<void> {
  const check = new Checker(nonEmpty(context.json)).writable(TRIAGE_WRITABLE);
  await consoleWrite(context, 200, async (client, row) => {
    const notes = check.has("triage_notes") ? check.multiLine("triage_notes", 0, 4000) : row.triage_notes;
    const fit = check.has("fit_score") && check.body.fit_score !== null ? check.integer("fit_score", 1, 5) : null;
    const floor = check.has("rate_floor_cents") && check.body.rate_floor_cents !== null
      ? check.integer("rate_floor_cents", 0, Number.MAX_SAFE_INTEGER) : null;
    check.done();
    await client.query(
      `UPDATE enquiries SET triage_notes = $2,
         fit_score = CASE WHEN $5 THEN $3::int ELSE fit_score END,
         rate_floor_cents = CASE WHEN $6 THEN $4::bigint ELSE rate_floor_cents END
       WHERE id = $1`,
      [row.id, notes, fit, floor, check.has("fit_score"), check.has("rate_floor_cents")],
    );
  });
}

const CONSOLE_MOVES = ["qualified", "declined", "booked"] as const;

async function moveEnquiry(context: Context): Promise<void> {
  const check = new Checker(asObject(context.json)).writable(["to"]);
  const to = check.body.to as (typeof CONSOLE_MOVES)[number];
  if (!CONSOLE_MOVES.includes(to)) check.error("to", "Choose qualified, declined or booked.");
  await consoleWrite(context, 200, async (client, row) => {
    if (!CONSOLE_MOVES.includes(to)) check.done();
    assertMove(row.read_status, to);
    check.done();
    await client.query("UPDATE enquiries SET status = $2 WHERE id = $1", [row.id, to]);
    if (to === "declined") await cancelProposalMail(client, row.id);
  });
}

// ---- CSV ----

const CSV_HEADER = ["reference", "received_at", "status", "name", "email", "studio", "brief", "preferred_month",
  "project_slug", "fit_score", "receipt"] as const;

/** A cell starting with a formula trigger gets a leading quote; then RFC 4180 quoting. */
function csvCell(value: string | number | null): string {
  if (value === null) return "";
  let text = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

async function exportCsv({ res }: Context): Promise<void> {
  const rows = await query<EnquiryRow>(`${ENQUIRY_SELECT} ORDER BY e.reference_number DESC`);
  const lines = [CSV_HEADER.join(",")];
  for (const row of rows) {
    const e = toEnquiry(row);
    lines.push([e.reference, e.received_at, e.status, e.name, e.email, e.studio, e.brief, e.preferred_month,
      e.project_slug, e.fit_score, e.receipt].map(csvCell).join(","));
  }
  sendBytes(res, "text/csv; charset=utf-8", Buffer.from(`${lines.join("\r\n")}\r\n`), {
    "Content-Disposition": 'attachment; filename="earshot-enquiries.csv"',
  });
}

export const enquiryRoutes: Route[] = [
  { pattern: "/api/enquiries", methods: { POST: { handler: sendBrief, body: "enquiry" } } },
  { pattern: "/api/console/enquiries", methods: { GET: { handler: listEnquiries } } },
  { pattern: "/api/console/enquiries.csv", methods: { GET: { handler: exportCsv } } },
  { pattern: "/api/console/enquiries/:id", methods: { GET: { handler: getEnquiry }, PATCH: { handler: saveTriage } } },
  { pattern: "/api/console/enquiries/:id/attachment", methods: { GET: { handler: getAttachment } } },
  { pattern: "/api/console/enquiries/:id/transition", methods: { POST: { handler: moveEnquiry } } },
];
