import type { Pool } from "pg";
import { agencyDateKey, billableMinutes, centsToMoney, chargeCents, parseDollars } from "../shared/domain.js";
import { ApiError, notFound } from "./errors.js";
import { CERT_FILE_LIMIT, Router, type Ctx } from "./http.js";
import { newId, sha256Hex } from "./crypto.js";
import { projectCredential, instantIso } from "./projection.js";
import type { App, AuthedCtx } from "./requests.js";
import { fmtAgencyDate, fmtAgencyTime, loadRequest, loadSeats, projectForViewer, searchMatch } from "./requests.js";
import type { DbCharge, DbCredential, DbOrganisation, DbPerson } from "./db_types.js";
import type { S3Store } from "./s3.js";
import type { SessionStore } from "./session.js";

export type Quote = {
  kind: "early" | "late";
  fee: string;
  free_cancel_until: string;
  billable_minutes: number;
  seats_charged: number;
  hourly_rate: string;
};

export type PublicInvoice = {
  id: string;
  request_reference: string;
  organisation: { id: string; name: string; code: string };
  kind: "interpreting" | "late_cancellation";
  billable_minutes: number;
  seats: number;
  hourly_rate: string;
  amount: string;
  billing_status: "pending" | "posted";
  killbill_invoice_id: string | null;
  created_at: string;
};

export function chargeToInvoice(charge: DbCharge, reference: string, org: DbOrganisation): PublicInvoice {
  return {
    id: charge.id,
    request_reference: reference,
    organisation: { id: org.id, name: org.name, code: org.code },
    kind: charge.kind,
    billable_minutes: charge.billable_minutes,
    seats: charge.seats,
    hourly_rate: centsToMoney(charge.hourly_rate_cents),
    amount: centsToMoney(charge.amount_cents),
    billing_status: charge.billing_status,
    killbill_invoice_id: charge.killbill_invoice_id,
    created_at: instantIso(charge.created_at),
  };
}

export function buildExtraRouter(
  app: App,
  sessions: SessionStore,
  s3: S3Store,
): Router {
  const router = new Router();
  const pool = app.pool;

  async function requireAuth(ctx: Ctx): Promise<AuthedCtx> {
    const token = readSessionToken(ctx);
    const person = await sessions.person(token);
    if (!person) throw new ApiError("unauthenticated", "Sign in to continue.");
    const organisation = await sessions.organisation(person);
    return { ...ctx, viewer: person, organisation, sessionToken: token };
  }

  /* ------------------------------------------------------- cancellation */

  async function computeQuote(requestId: string): Promise<{ quote: Quote; org: DbOrganisation } | null> {
    const row = await loadRequest(pool, requestId);
    if (!row) return null;
    const seats = await loadSeats(pool, requestId);
    const confirmed = seats.filter((s) => s.seat.status === "confirmed").length;
    const now = Date.now();
    const late = now >= row.request.free_cancel_until.getTime();
    const billable = late ? billableMinutes(row.request.duration_minutes) : 0;
    const seatsCharged = late ? confirmed : 0;
    const amountCents = late
      ? chargeCents(row.request.duration_minutes, row.organisation.hourly_rate_cents, confirmed)
      : 0;
    return {
      quote: {
        kind: late ? "late" : "early",
        fee: centsToMoney(amountCents),
        free_cancel_until: instantIso(row.request.free_cancel_until),
        billable_minutes: billable,
        seats_charged: seatsCharged,
        hourly_rate: centsToMoney(row.organisation.hourly_rate_cents),
      },
      org: row.organisation,
    };
  }

  router.add("GET", "/api/requests/:id/cancellation-quote", async (ctx) => {
    const auth = await requireAuth(ctx);
    const id = ctx.params["id"] ?? "";
    if (auth.viewer.role !== "client_scheduler" && auth.viewer.role !== "coordinator") {
      throw new ApiError("forbidden", "This account cannot cancel bookings.");
    }
    const row = await loadRequest(pool, id);
    if (!row) throw notFound();
    if (auth.viewer.role === "client_scheduler" && row.request.organisation_id !== auth.organisation?.id) {
      throw notFound();
    }
    if (!["draft", "submitted", "half_staffed", "staffed"].includes(row.request.status)) {
      throw new ApiError("invalid_transition", "This booking can no longer be cancelled.");
    }
    const computed = await computeQuote(id);
    if (!computed) throw notFound();
    return { status: 200, body: computed.quote };
  });

  router.add("POST", "/api/requests/:id/cancel", async (ctx) => {
    const auth = await requireAuth(ctx);
    const id = ctx.params["id"] ?? "";
    if (auth.viewer.role !== "client_scheduler" && auth.viewer.role !== "coordinator") {
      throw new ApiError("forbidden", "This account cannot cancel bookings.");
    }
    const idempotencyKey = readIdempotencyKey(ctx);
    const idemFields: Record<string, string> = {};
    if (idempotencyKey === null) {
      idemFields["Idempotency-Key"] = "Send an Idempotency-Key header of 1 to 64 characters.";
    }
    const body = ctx.body as { expected_fee?: unknown };
    const expectedFee = typeof body?.expected_fee === "string" ? body.expected_fee : null;
    if (expectedFee === null || centsToMoney(parseFee(expectedFee)) !== expectedFee) {
      idemFields["expected_fee"] = "Send the quoted fee as a dollar amount with two decimals.";
    }
    if (Object.keys(idemFields).length > 0) {
      throw new ApiError("validation", "Check the highlighted fields.", { fields: idemFields });
    }
    const row = await loadRequest(pool, id);
    if (!row) throw notFound();
    if (auth.viewer.role === "client_scheduler" && row.request.organisation_id !== auth.organisation?.id) {
      throw notFound();
    }
    const replay = await replayOrReuse(pool, idempotencyKey ?? "", auth.viewer.id, "POST /api/requests/{id}/cancel", id, sha256Hex(ctx.rawBody));
    if (replay.type === "replay") return { status: replay.status, body: replay.body };
    if (replay.type === "reused") {
      throw new ApiError("idempotency_key_reused", "This key was used for a different action.");
    }
    if (!["draft", "submitted", "half_staffed", "staffed"].includes(row.request.status)) {
      throw new ApiError("invalid_transition", "This booking can no longer be cancelled.");
    }
    const computed = await computeQuote(id);
    if (!computed) throw notFound();
    if (expectedFee !== computed.quote.fee) {
      throw new ApiError("fee_changed", "The fee has changed. Review the new quote and confirm again.", {
        extra: { quote: computed.quote },
      });
    }
    const seats = await loadSeats(pool, id);
    const confirmedPeople = seats
      .filter((s) => s.seat.status === "confirmed" && s.interpreter)
      .map((s) => s.interpreter as DbPerson);
    const late = computed.quote.kind === "late";
    const client = await pool.connect();
    let invoiceId: string | null = null;
    try {
      await client.query("BEGIN");
      const statusValue = late ? "cancelled_late" : "cancelled_early";
      await client.query("UPDATE request SET status = $2 WHERE id = $1", [id, statusValue]);
      await client.query("UPDATE seat SET status = 'open', interpreter_id = NULL, confirmed_at = NULL WHERE request_id = $1", [id]);
      await client.query(
        "INSERT INTO history_entry (request_id, actor_id, actor_name, action, detail) VALUES ($1,$2,$3,'cancelled',$4)",
        [id, auth.viewer.id, auth.viewer.display_name, `${computed.quote.kind} cancellation, fee ${computed.quote.fee}`],
      );
      if (late && computed.quote.fee !== "0.00") {
        invoiceId = newId("chg");
        await client.query(
          `INSERT INTO charge (id, request_id, organisation_id, kind, billable_minutes, seats, hourly_rate_cents, amount_cents, billing_status)
           VALUES ($1,$2,$3,'late_cancellation',$4,$5,$6,$7,'pending')`,
          [invoiceId, id, row.request.organisation_id, computed.quote.billable_minutes, computed.quote.seats_charged,
            row.organisation.hourly_rate_cents, chargeCentsFrom(computed.quote.fee)],
        );
        await client.query("INSERT INTO kb_posting (charge_id) VALUES ($1)", [invoiceId]);
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
    // emails
    const scheduler = (await pool.query<DbPerson>(
      "SELECT * FROM person WHERE organisation_id = $1 AND role = 'client_scheduler'", [row.request.organisation_id],
    )).rows[0];
    if (scheduler) {
      await app.mail.enqueue(
        scheduler.email,
        `Cancelled: ${row.request.reference}, fee $${computed.quote.fee}`,
        `${row.request.reference} was cancelled ${computed.quote.kind === "late" ? "after the free-cancellation deadline" : "within the free-cancellation window"}.\n` +
        `Fee: $${computed.quote.fee}\n` +
        `Billable minutes: ${computed.quote.billable_minutes}\n` +
        `Seats charged: ${computed.quote.seats_charged}\n` +
        `Hourly rate: $${computed.quote.hourly_rate}\n`,
      );
    }
    for (const person of confirmedPeople) {
      await app.mail.enqueue(
        person.email,
        `Assignment cancelled: ${row.request.reference}, ${fmtAgencyDate(instantIso(row.request.starts_at))}`,
        `${row.request.reference} on ${fmtAgencyDate(instantIso(row.request.starts_at))} from ${fmtAgencyTime(instantIso(row.request.starts_at))} to ${fmtAgencyTime(instantIso(new Date(row.request.starts_at.getTime() + row.request.duration_minutes * 60_000)))} has been cancelled.\n`,
      );
    }
    const fresh = await loadRequest(pool, id);
    const seatsAfter = fresh ? await loadSeats(pool, id) : [];
    const projected = fresh ? await projectForViewer(app, auth, fresh, seatsAfter) : null;
    let invoice: PublicInvoice | null = null;
    if (invoiceId) {
      invoice = await chargeById(pool, invoiceId, row.request.reference, row.organisation);
    }
    const responseBody = { request: projected, invoice };
    await storeIdempotent(pool, idempotencyKey ?? "", auth.viewer.id, "POST /api/requests/{id}/cancel", id, sha256Hex(ctx.rawBody), 200, responseBody);
    return { status: 200, body: responseBody };
  });

  /* ------------------------------------------------------------- close */

  router.add("POST", "/api/requests/:id/close", async (ctx) => {
    const auth = await requireAuth(ctx);
    if (auth.viewer.role !== "billing_admin") {
      throw new ApiError("forbidden", "Only a billing admin can close a job.");
    }
    const id = ctx.params["id"] ?? "";
    const idempotencyKey = readIdempotencyKey(ctx);
    if (idempotencyKey === null) {
      throw new ApiError("validation", "Check the highlighted fields.", {
        fields: { "Idempotency-Key": "Send an Idempotency-Key header of 1 to 64 characters." },
      });
    }
    const row = await loadRequest(pool, id);
    if (!row) throw notFound();
    const replay = await replayOrReuse(pool, idempotencyKey ?? "", auth.viewer.id, "POST /api/requests/{id}/close", id, sha256Hex(ctx.rawBody));
    if (replay.type === "replay") return { status: replay.status, body: replay.body };
    if (replay.type === "reused") {
      throw new ApiError("idempotency_key_reused", "This key was used for a different action.");
    }
    if (row.request.status !== "completed") {
      throw new ApiError("invalid_transition", "Only a completed job can be closed.");
    }
    const seats = await loadSeats(pool, id);
    const confirmed = seats.filter((s) => s.seat.status === "confirmed").length;
    const actual = row.request.actual_minutes ?? 0;
    const amountCents = chargeCents(actual, row.organisation.hourly_rate_cents, confirmed);
    const chargeId = newId("chg");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("UPDATE request SET status = 'invoiced' WHERE id = $1", [id]);
      await client.query(
        `INSERT INTO charge (id, request_id, organisation_id, kind, billable_minutes, seats, hourly_rate_cents, amount_cents, billing_status)
         VALUES ($1,$2,$3,'interpreting',$4,$5,$6,$7,'pending')`,
        [chargeId, id, row.request.organisation_id, billableMinutes(actual), confirmed,
          row.organisation.hourly_rate_cents, amountCents],
      );
      await client.query("INSERT INTO kb_posting (charge_id) VALUES ($1)", [chargeId]);
      await client.query(
        "INSERT INTO history_entry (request_id, actor_id, actor_name, action, detail) VALUES ($1,$2,$3,'closed',$4)",
        [id, auth.viewer.id, auth.viewer.display_name, `$${centsToMoney(amountCents)}`],
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
    const scheduler = (await pool.query<DbPerson>(
      "SELECT * FROM person WHERE organisation_id = $1 AND role = 'client_scheduler'", [row.request.organisation_id],
    )).rows[0];
    if (scheduler) {
      const amount = centsToMoney(amountCents);
      await app.mail.enqueue(
        scheduler.email,
        `Charges for ${row.request.reference}: $${amount}`,
        `Charges for ${row.request.reference}:\n` +
        `Amount: $${amount}\n` +
        `Billable minutes: ${billableMinutes(actual)}\n` +
        `Seats: ${confirmed}\n` +
        `Hourly rate: $${centsToMoney(row.organisation.hourly_rate_cents)}\n`,
      );
    }
    const fresh = await loadRequest(pool, id);
    const projected = fresh ? await projectForViewer(app, auth, fresh, await loadSeats(pool, id)) : null;
    const invoice = await chargeById(pool, chargeId, row.request.reference, row.organisation);
    const responseBody = { request: projected, invoice };
    await storeIdempotent(pool, idempotencyKey ?? "", auth.viewer.id, "POST /api/requests/{id}/close", id, sha256Hex(ctx.rawBody), 200, responseBody);
    return { status: 200, body: responseBody };
  });

  /* --------------------------------------------------------- invoices */

  router.add("GET", "/api/invoices", async (ctx) => {
    const auth = await requireAuth(ctx);
    if (auth.viewer.role !== "billing_admin" && auth.viewer.role !== "client_scheduler") {
      throw new ApiError("forbidden", "This account cannot list invoices.");
    }
    const q = ctx.url.searchParams.get("q") ?? "";
    const { rows } = await pool.query<DbCharge & { reference: string; org_name: string; org_code: string; hourly_rate_cents: number }>(
      `SELECT c.*, r.reference, o.name AS org_name, o.code AS org_code, o.hourly_rate_cents
         FROM charge c
         JOIN request r ON r.id = c.request_id
         JOIN organisation o ON o.id = c.organisation_id
        ${auth.viewer.role === "client_scheduler" ? "WHERE c.organisation_id = $1" : ""}
        ORDER BY c.created_at DESC, c.id`,
      auth.viewer.role === "client_scheduler" ? [auth.organisation?.id] : [],
    );
    const invoices = [];
    for (const r of rows) {
      if (!searchMatch([r.reference], q)) continue;
      const org: DbOrganisation = { id: r.organisation_id, name: r.org_name, code: r.org_code, hourly_rate_cents: r.hourly_rate_cents };
      const charge: DbCharge = {
        id: r.id, request_id: r.request_id, organisation_id: r.organisation_id, kind: r.kind,
        billable_minutes: r.billable_minutes, seats: r.seats, hourly_rate_cents: r.hourly_rate_cents,
        amount_cents: r.amount_cents, billing_status: r.billing_status,
        killbill_invoice_id: r.killbill_invoice_id, created_at: r.created_at,
      };
      invoices.push(chargeToInvoice(charge, r.reference, org));
    }
    return { status: 200, body: { invoices } };
  });

  router.add("GET", "/api/invoices.csv", async (ctx) => {
    const auth = await requireAuth(ctx);
    if (auth.viewer.role !== "billing_admin" && auth.viewer.role !== "client_scheduler") {
      throw new ApiError("forbidden", "This account cannot export invoices.");
    }
    const q = ctx.url.searchParams.get("q") ?? "";
    const { rows } = await pool.query<DbCharge & { reference: string; org_name: string; org_code: string; hourly_rate_cents: number }>(
      `SELECT c.*, r.reference, o.name AS org_name, o.code AS org_code, o.hourly_rate_cents
         FROM charge c
         JOIN request r ON r.id = c.request_id
         JOIN organisation o ON o.id = c.organisation_id
        ${auth.viewer.role === "client_scheduler" ? "WHERE c.organisation_id = $1" : ""}
        ORDER BY c.created_at DESC, c.id`,
      auth.viewer.role === "client_scheduler" ? [auth.organisation?.id] : [],
    );
    const header = "reference,organisation,kind,billable_minutes,seats,hourly_rate,amount,billing_status,killbill_invoice_id,created_at";
    const lines = [header];
    for (const r of rows) {
      if (!searchMatch([r.reference], q)) continue;
      const org: DbOrganisation = { id: r.organisation_id, name: r.org_name, code: r.org_code, hourly_rate_cents: r.hourly_rate_cents };
      const charge: DbCharge = {
        id: r.id, request_id: r.request_id, organisation_id: r.organisation_id, kind: r.kind,
        billable_minutes: r.billable_minutes, seats: r.seats, hourly_rate_cents: r.hourly_rate_cents,
        amount_cents: r.amount_cents, billing_status: r.billing_status,
        killbill_invoice_id: r.killbill_invoice_id, created_at: r.created_at,
      };
      const inv = chargeToInvoice(charge, r.reference, org);
      lines.push([
        inv.request_reference, inv.organisation.name, inv.kind, String(inv.billable_minutes), String(inv.seats),
        inv.hourly_rate, inv.amount, inv.billing_status, inv.killbill_invoice_id ?? "", inv.created_at,
      ].map(csvField).join(","));
    }
    const csv = lines.join("\r\n") + "\r\n";
    return {
      status: 200,
      body: csv,
      headers: { "Content-Type": "text/csv; charset=utf-8" },
    };
  });

  /* ------------------------------------------------------ credentials */

  router.add("GET", "/api/me/credentials", async (ctx) => {
    const auth = await requireAuth(ctx);
    if (auth.viewer.role !== "interpreter") {
      throw new ApiError("forbidden", "Only an interpreter can view their credentials.");
    }
    const { rows } = await pool.query(
      "SELECT * FROM credential WHERE interpreter_id = $1 ORDER BY uploaded_at",
      [auth.viewer.id],
    );
    return { status: 200, body: { credentials: rows.map(projectCredential) } };
  });

  router.add("POST", "/api/me/credentials", async (ctx) => {
    const auth = await requireAuth(ctx);
    if (auth.viewer.role !== "interpreter") {
      throw new ApiError("forbidden", "Only an interpreter can upload a certificate.");
    }
    const raw = ctx.rawBody;
    const contentType = ctx.req.headers["content-type"] ?? "";
    const m = /boundary=(.+)$/.exec(contentType);
    if (!contentType.startsWith("multipart/form-data") || !m) {
      throw new ApiError("unsupported_type", "Upload the certificate as multipart/form-data.");
    }
    const parts = splitMultipart(raw, m[1] ?? "");
    const typeField = parts.find((p) => p.name === "credential_type")?.text ?? "";
    const filePart = parts.find((p) => p.name === "file");
    const fields: Record<string, string> = {};
    if (!["NIC", "CDI", "SC:L", "EIPA"].includes(typeField)) {
      fields["credential_type"] = "Choose NIC, CDI, SC:L or EIPA.";
    }
    if (!filePart || filePart.data.length === 0) {
      fields["file"] = "Choose a certificate file.";
    }
    if (Object.keys(fields).length > 0) {
      throw new ApiError("validation", "Check the highlighted fields.", { fields });
    }
    const file = filePart as { data: Buffer; filename: string };
    if (file.data.length > CERT_FILE_LIMIT) {
      throw new ApiError("payload_too_large", "That file is over 5,000,000 bytes. Choose a smaller file.");
    }
    const detected = detectFileType(file.data);
    if (!detected) {
      throw new ApiError("unsupported_type", "Upload a PDF, PNG or JPEG file.");
    }
    const id = newId("cred");
    const displayName = sanitiseFileName(file.filename);
    const key = `credentials/${auth.viewer.id}/${id}.${detected === "application/pdf" ? "pdf" : detected === "image/png" ? "png" : "jpg"}`;
    try {
      await s3.putObject(key, file.data, detected);
    } catch {
      throw new ApiError("storage_unavailable", "Certificate storage is unreachable.");
    }
    await pool.query(
      `INSERT INTO credential (id, interpreter_id, credential_type, status, uploaded_at, file_name, storage_key)
       VALUES ($1,$2,$3,'uploaded', now(), $4, $5)`,
      [id, auth.viewer.id, typeField, displayName, key],
    );
    const { rows } = await pool.query("SELECT * FROM credential WHERE id = $1", [id]);
    return { status: 201, body: projectCredential(rows[0]!) };
  });

  router.add("GET", "/api/credentials", async (ctx) => {
    const auth = await requireAuth(ctx);
    if (auth.viewer.role !== "coordinator") {
      throw new ApiError("forbidden", "Only a coordinator can review credentials.");
    }
    const status = ctx.url.searchParams.get("status") ?? "uploaded";
    const today = agencyDateKey(new Date());
    const { rows } = await pool.query(
      `SELECT c.*, p.display_name, p.full_name
         FROM credential c JOIN person p ON p.id = c.interpreter_id
        ORDER BY c.uploaded_at`,
    );
    const out = [];
    for (const r of rows) {
      const effective = effectiveStatus(r.status, r.expires_on ? r.expires_on.toISOString().slice(0, 10) : null, today);
      if (status !== "all" && status !== effective) continue;
      const projected = projectCredential(r);
      out.push({ ...projected, interpreter: { id: r.interpreter_id, display_name: r.display_name, full_name: r.full_name } });
    }
    return { status: 200, body: { credentials: out } };
  });

  router.add("POST", "/api/credentials/:id/verify", async (ctx) => {
    const auth = await requireAuth(ctx);
    if (auth.viewer.role !== "coordinator") {
      throw new ApiError("forbidden", "Only a coordinator can verify credentials.");
    }
    const id = ctx.params["id"] ?? "";
    const { rows } = await pool.query("SELECT * FROM credential WHERE id = $1", [id]);
    const cred = rows[0];
    if (!cred) throw notFound();
    if (cred.status !== "uploaded") {
      throw new ApiError("invalid_transition", "Only an uploaded certificate can be verified.");
    }
    const body = ctx.body as { expires_on?: unknown };
    const expiresOn = typeof body?.expires_on === "string" ? body.expires_on : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expiresOn) || !isRealDate(expiresOn)) {
      throw new ApiError("validation", "Check the highlighted fields.", {
        fields: { expires_on: "Enter the expiry date as YYYY-MM-DD." },
      });
    }
    if (expiresOn < agencyDateKey(new Date())) {
      throw new ApiError("validation", "Check the highlighted fields.", {
        fields: { expires_on: "The expiry date must be today or later." },
      });
    }
    await pool.query("UPDATE credential SET status = 'verified', expires_on = $2 WHERE id = $1", [id, expiresOn]);
    const fresh = (await pool.query("SELECT * FROM credential WHERE id = $1", [id])).rows[0];
    return { status: 200, body: projectCredential(fresh) };
  });

  router.add("GET", "/api/credentials/:id/file", async (ctx) => {
    const auth = await requireAuth(ctx);
    if (auth.viewer.role !== "coordinator") {
      throw new ApiError("forbidden", "Only a coordinator can view certificate files.");
    }
    const id = ctx.params["id"] ?? "";
    const { rows } = await pool.query("SELECT * FROM credential WHERE id = $1", [id]);
    const cred = rows[0];
    if (!cred) throw notFound();
    if (!cred.storage_key) throw notFound();
    try {
      const url = s3.signedUrl(cred.storage_key, 60);
      return { status: 200, body: { url, expires_in_seconds: 60 } };
    } catch {
      throw new ApiError("storage_unavailable", "Certificate storage is unreachable.");
    }
  });

  return router;
}

/* -------------------------------------------------------------- helpers */

async function chargeById(pool: Pool, chargeId: string, reference: string, org: DbOrganisation): Promise<PublicInvoice> {
  const { rows } = await pool.query<DbCharge>("SELECT * FROM charge WHERE id = $1", [chargeId]);
  const charge = rows[0];
  if (!charge) throw notFound();
  return chargeToInvoice(charge, reference, org);
}

function readSessionToken(ctx: Ctx): string | null {
  const header = ctx.req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === "session") return rest.join("=");
  }
  return null;
}

function readIdempotencyKey(ctx: Ctx): string | null {
  const raw = ctx.req.headers["idempotency-key"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return null;
  if (value.length < 1 || value.length > 64) return null;
  if (!/^[\x20-\x7E]+$/.test(value)) return null;
  return value;
}

function parseFee(s: string): number {
  return parseDollars(s) ?? NaN;
}

function chargeCentsFrom(fee: string): number {
  return parseDollars(fee) ?? 0;
}

function effectiveStatus(status: string, expiresOn: string | null, todayKey: string): "uploaded" | "verified" | "expired" {
  if (status === "uploaded") return "uploaded";
  if (expiresOn === null) return "verified";
  return expiresOn >= todayKey ? "verified" : "expired";
}

function isRealDate(dayKey: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const probe = new Date(Date.UTC(y, mo - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d;
}

function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** A repeated Idempotency-Key replays the stored response; a key reused for a different action is rejected. */
async function replayOrReuse(
  pool: Pool,
  key: string,
  userId: string,
  endpoint: string,
  requestId: string,
  bodyHash: string,
): Promise<{ type: "miss" } | { type: "replay"; status: number; body: unknown } | { type: "reused" }> {
  const { rows } = await pool.query(
    "SELECT request_id, body_hash, status, response_body FROM idempotency_key WHERE key = $1 AND user_id = $2 AND endpoint = $3",
    [key, userId, endpoint],
  );
  const row = rows[0];
  if (!row) return { type: "miss" };
  if (row.request_id !== requestId) return { type: "reused" };
  if (row.body_hash !== bodyHash) return { type: "reused" };
  return { type: "replay", status: row.status, body: row.response_body };
}

async function storeIdempotent(
  pool: Pool,
  key: string,
  userId: string,
  endpoint: string,
  requestId: string,
  bodyHash: string,
  status: number,
  body: unknown,
): Promise<void> {
  await pool.query(
    `INSERT INTO idempotency_key (key, user_id, endpoint, request_id, body_hash, status, response_body)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (key, user_id, endpoint) DO UPDATE
       SET request_id = EXCLUDED.request_id,
           body_hash = EXCLUDED.body_hash,
           status = EXCLUDED.status,
           response_body = EXCLUDED.response_body,
           created_at = now()`,
    [key, userId, endpoint, requestId, bodyHash, status, JSON.stringify(body)],
  );
}

/* ----------------------------------------------------- multipart parsing */

type MultipartPart = { name: string; filename: string; data: Buffer; text: string };

export function splitMultipart(body: Buffer, boundary: string): MultipartPart[] {
  const delim = Buffer.from(`--${boundary}`);
  const parts: MultipartPart[] = [];
  let idx = body.indexOf(delim);
  while (idx !== -1) {
    const next = body.indexOf(delim, idx + delim.length);
    if (next === -1) break;
    const chunk = body.subarray(idx + delim.length, next);
    const headerEnd = chunk.indexOf(Buffer.from("\r\n\r\n"));
    if (headerEnd === -1) { idx = next; continue; }
    const headerText = chunk.subarray(0, headerEnd).toString("utf8");
    const data = chunk.subarray(headerEnd + 4, chunk.length - 2);
    const nameMatch = /name="([^"]*)"/.exec(headerText);
    const fileMatch = /filename="([^"]*)"/.exec(headerText);
    parts.push({
      name: nameMatch?.[1] ?? "",
      filename: fileMatch?.[1] ?? "",
      data,
      text: data.toString("utf8").trim(),
    });
    idx = next;
  }
  return parts;
}

/** The certificate type is judged by the file's leading bytes only. */
export function detectFileType(data: Buffer): string | null {
  if (data.length >= 4 && data[0] === 0x25 && data[1] === 0x50 && data[2] === 0x44 && data[3] === 0x46) {
    return "application/pdf";
  }
  if (data.length >= 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
    return "image/png";
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return "image/jpeg";
  }
  return null;
}

export function sanitiseFileName(name: string): string {
  const last = name.split(/[\\/]/).pop() ?? "";
  const cleaned = last.replace(/[\x00-\x1f\x7f]/g, "");
  return cleaned.slice(0, 200);
}
