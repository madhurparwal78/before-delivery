import { Router } from "express";
import type { Request } from "express";
import busboyImport from "busboy";

/* The busboy type definitions export the constructor as a class type; this
 * module uses the default export directly. */
const Busboy = busboyImport as unknown as (options: {
  headers: Record<string, unknown>;
  limits: Record<string, number>;
}) => import("node:stream").Writable;
import { randomId } from "./ids.js";
import { query, withTransaction, withLedgerLock } from "./db.js";
import { requireAccount, type Account } from "./auth.js";
import { fetchReservation, fetchReservationClient, reservationWithDocs, offerBenchToWaitlist, type ReservationRow } from "./reservations.js";
import type { PaymentContext } from "./payments.js";
import type { Config } from "./config.js";
import { MULTIPART_BODY_LIMIT, FILE_LIMIT } from "./config.js";
import { venueDate, refundDueCents } from "./time.js";
import { queueMail } from "./mail.js";

export type MagicType = "pdf" | "jpeg" | "png";

/** File type is decided from the file's leading bytes; the extension is ignored. */
export function detectFileType(buf: Buffer): MagicType | null {
  if (buf.length >= 5 && buf.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  return null;
}

interface Relationship {
  isBuyer: boolean;
  isAttendee: boolean;
}

function relationship(r: ReservationRow, account: Account): Relationship {
  const isBuyer = r.buyer_id === account.id;
  const isAttendee =
    r.attendee_accepted && r.attendee_email !== null && r.attendee_email.toLowerCase() === account.email.toLowerCase();
  return { isBuyer, isAttendee };
}

interface UploadOutcome {
  status: number;
  body: Record<string, unknown>;
  fields?: Record<string, string>;
  file?: Buffer;
}

/**
 * Reads one multipart upload. The whole request is limited to 10,100,000
 * bytes (exactly that is allowed), the file to 10,000,000. Field validation
 * answers before the size and type rules.
 */
export async function readUpload(req: Request): Promise<UploadOutcome> {
  const err = (status: number, error: string, message: string, errors?: Record<string, string>): UploadOutcome => ({
    status,
    body: errors ? { error, message, errors } : { error, message },
  });
  return new Promise<UploadOutcome>((resolve) => {
    const busboy = Busboy({ headers: req.headers, limits: { fileSize: FILE_LIMIT, files: 2 } });
    const fields: Record<string, string> = {};
    let fileBuffer: Buffer | null = null;
    let fileCount = 0;
    let totalBytes = 0;
    let fileTooLarge = false;
    let payloadTooLarge = false;
    let settled = false;
    const finish = (value: UploadOutcome) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    busboy.on("field", (name, value) => {
      fields[name] = value;
    });
    busboy.on("file", (name, stream) => {
      fileCount += 1;
      const chunks: Buffer[] = [];
      let size = 0;
      stream.on("data", (chunk: Buffer) => {
        size += chunk.length;
        totalBytes += chunk.length;
        if (totalBytes > MULTIPART_BODY_LIMIT) payloadTooLarge = true;
        if (size > FILE_LIMIT) fileTooLarge = true;
        chunks.push(chunk);
      });
      stream.on("limit", () => {
        fileTooLarge = true;
      });
      stream.on("end", () => {
        if (fileCount === 1) fileBuffer = Buffer.concat(chunks);
      });
    });
    busboy.on("close", () => {
      if (payloadTooLarge) {
        finish(err(413, "payload_too_large", "That request is too large."));
        return;
      }
      if (fileCount > 1) {
        finish(err(422, "validation", "Some fields need attention.", { file: "Send exactly one file." }));
        return;
      }
      if (!fileBuffer) {
        finish(err(422, "validation", "Some fields need attention.", { file: "Send a PDF, JPEG or PNG file." }));
        return;
      }
      finish({ status: 200, body: {}, fields, file: fileBuffer });
    });
    busboy.on("error", () => {
      finish(err(400, "malformed_json", "That upload could not be read."));
    });
    req.pipe(busboy as unknown as NodeJS.WritableStream);
  });
}

function validateUploadFields(kind: "licence" | "passport", fields: Record<string, string>): Record<string, string> {
  const errors: Record<string, string> = {};
  if (kind === "licence") {
    const number = fields["licence_number"];
    const state = fields["licence_state"];
    if (!number || number.length < 1 || number.length > 40) errors.licence_number = "Enter a licence number of 1 to 40 characters.";
    if (!state || state.length < 1 || state.length > 60) errors.licence_state = "Enter an issuing state of 1 to 60 characters.";
  } else {
    for (const [field, max] of [["full_name", 120], ["nationality", 120], ["passport_number", 120]] as const) {
      const v = fields[field];
      if (!v || v.length < 1 || v.length > max) errors[field] = `Enter a value of 1 to ${max} characters.`;
    }
  }
  return errors;
}

export function makeReservationsRouter(cfg: Config, ctx: PaymentContext): Router {
  const router = Router();

  // GET /api/reservations/{id} — buyer, attendee, registrar.
  router.get("/reservations/:id", async (req, res, next) => {
    try {
      const account = await requireAccount(req);
      if (account.role !== "practitioner" && account.role !== "clinic" && account.role !== "registrar") {
        res.status(403).json({ error: "forbidden", message: "You may not do that." });
        return;
      }
      const r = await fetchReservation(req.params.id!);
      if (!r) {
        res.status(404).json({ error: "not_found", message: "Nothing here." });
        return;
      }
      const rel = relationship(r, account);
      if (!rel.isBuyer && !rel.isAttendee && account.role !== "registrar") {
        res.status(404).json({ error: "not_found", message: "Nothing here." });
        return;
      }
      res.json({ reservation: await reservationWithDocs(r), server_time: new Date().toISOString() });
    } catch (e) {
      next(e);
    }
  });

  // GET /api/groups/{id} — buyer, registrar.
  router.get("/groups/:id", async (req, res, next) => {
    try {
      const account = await requireAccount(req);
      if (account.role !== "clinic" && account.role !== "registrar") {
        res.status(404).json({ error: "not_found", message: "Nothing here." });
        return;
      }
      const { rows } = await query<{ buyer_id: string }>("SELECT buyer_id FROM groups WHERE id = $1", [req.params.id]);
      const g = rows[0];
      if (!g || (g.buyer_id !== account.id && account.role !== "registrar")) {
        res.status(404).json({ error: "not_found", message: "Nothing here." });
        return;
      }
      const { groupPayload } = await import("./paymentRoutes.js");
      res.json({ group: await groupPayload(req.params.id!) });
    } catch (e) {
      next(e);
    }
  });

  // POST /api/reservations/{id}/cancel — buyer.
  router.post("/reservations/:id/cancel", async (req, res, next) => {
    try {
      const account = await requireAccount(req);
      if (account.role !== "practitioner" && account.role !== "clinic") {
        res.status(403).json({ error: "forbidden", message: "You may not do that." });
        return;
      }
      const { id } = req.params;
      const outcome = await withTransaction(async (client) => {
        return withLedgerLock(client, async () => {
          const r = await fetchReservationClient(client, id!);
          if (!r || r.buyer_id !== account.id) return { code: "not_found" as const };
          if (r.state !== "deposit_paid" && r.state !== "paid_in_full") {
            return { code: "invalid_transition" as const };
          }
          const due = refundDueCents(r.paid_cents, venueDate(cfg.benchDaysNow));
          if (due === null) return { code: "no_refund_window" as const };
          await client.query(
            "UPDATE reservations SET state = 'cancelled', refund_due_cents = $2, payment_in_flight = FALSE, payment_pending = NULL, upgrade_bench = NULL WHERE id = $1",
            [id, due]
          );
          const offered = await offerBenchToWaitlist(client, r.bench, cfg);
          return { code: "ok" as const, offered };
        });
      });
      if (outcome.code === "not_found") {
        res.status(404).json({ error: "not_found", message: "Nothing here." });
        return;
      }
      if (outcome.code === "invalid_transition") {
        res.status(409).json({ error: "invalid_transition", message: "This seat cannot be cancelled now." });
        return;
      }
      if (outcome.code === "no_refund_window") {
        res.status(409).json({ error: "no_refund_window", message: "Refunds closed on 19 March 2027. You can assign this seat to a colleague instead." });
        return;
      }
      if (outcome.offered) {
        await queueMail(outcome.offered.accountEmail, "A bench is open for you: sign in to accept", "A bench in your tier has opened at Opaline Bench Days. Sign in to your account to accept it within the offer window: /account");
      }
      const row = await fetchReservation(id!);
      res.json({ reservation: row ? await reservationWithDocs(row) : null });
    } catch (e) {
      next(e);
    }
  });

  // PUT /api/reservations/{id}/assignee — buyer.
  router.put("/reservations/:id/assignee", async (req, res, next) => {
    try {
      const account = await requireAccount(req);
      if (account.role !== "practitioner" && account.role !== "clinic") {
        res.status(403).json({ error: "forbidden", message: "You may not do that." });
        return;
      }
      const { id } = req.params;
      const name = req.body?.name;
      const email = req.body?.email;
      const errors: Record<string, string> = {};
      if (typeof name !== "string" || name.length < 1 || name.length > 120) errors.name = "Enter a name of 1 to 120 characters.";
      if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = "Enter a valid email.";
      if (Object.keys(errors).length > 0) {
        res.status(422).json({ error: "validation", message: "Some fields need attention.", errors });
        return;
      }
      const outcome = await withTransaction(async (client) => {
        return withLedgerLock(client, async () => {
          const r = await fetchReservationClient(client, id!);
          if (!r || r.buyer_id !== account.id) return { code: "not_found" as const };
          if (r.state !== "deposit_paid" && r.state !== "paid_in_full") {
            return { code: "invalid_transition" as const };
          }
          const { rows: attending } = await client.query(
            `SELECT id FROM reservations
             WHERE attendee_email = $1 AND attendee_accepted = true AND id <> $2
               AND state IN ('held','deposit_paid','paid_in_full','checked_in_day1','checked_in_day2','certificate_issued')`,
            [email, id]
          );
          if (attending.length > 0) return { code: "already_attending" as const };
          const changed = r.attendee_name !== name || (r.attendee_email ?? "") !== email;
          const oldKeys = {
            licence: r.licence_object_key,
            passport: r.passport_object_key,
          };
          await client.query(
            `UPDATE reservations SET attendee_name = $2, attendee_email = $3, attendee_accepted = FALSE,
               licence_status = 'none', licence_number = NULL, licence_state = NULL, licence_object_key = NULL,
               passport_status = 'none', passport_full_name = NULL, passport_nationality = NULL,
               passport_number = NULL, passport_object_key = NULL
             WHERE id = $1`,
            [id, name, email]
          );
          await client.query("DELETE FROM documents WHERE reservation_id = $1 AND kind = 'visa-letter'", [id]);
          const { rows: visaKey } = await client.query<{ object_key: string }>(
            "SELECT object_key FROM documents WHERE reservation_id = $1 AND kind = 'visa-letter'",
            [id]
          );
          return { code: "ok" as const, changed, bench: r.bench, oldKeys, visaKey: visaKey[0]?.object_key ?? null };
        });
      });
      if (outcome.code === "not_found") {
        res.status(404).json({ error: "not_found", message: "Nothing here." });
        return;
      }
      if (outcome.code === "invalid_transition") {
        res.status(409).json({ error: "invalid_transition", message: "This seat cannot be reassigned now." });
        return;
      }
      if (outcome.code === "already_attending") {
        res.status(409).json({ error: "already_attending", message: "That colleague already attends a seat." });
        return;
      }
      // The former assignee's scan objects are deleted from MinIO.
      if (outcome.oldKeys.licence) await ctx.s3.delete(outcome.oldKeys.licence).catch(() => undefined);
      if (outcome.oldKeys.passport) await ctx.s3.delete(outcome.oldKeys.passport).catch(() => undefined);
      if (outcome.visaKey) await ctx.s3.delete(outcome.visaKey).catch(() => undefined);
      if (outcome.changed) {
        await queueMail(email, `${account.clinic_name ?? account.name} assigned you Bench ${outcome.bench} at Opaline Bench Days`, "You have been assigned a seat at Opaline Bench Days. Sign in and accept it in your account: /account");
      }
      const row = await fetchReservation(id!);
      res.json({ reservation: row ? await reservationWithDocs(row) : null });
    } catch (e) {
      next(e);
    }
  });

  // POST /api/reservations/{id}/accept — the currently named assignee.
  router.post("/reservations/:id/accept", async (req, res, next) => {
    try {
      const account = await requireAccount(req);
      if (account.role !== "practitioner") {
        const status = account.role === "clinic" ? 404 : 403;
        res.status(status).json({ error: status === 404 ? "not_found" : "forbidden", message: status === 404 ? "Nothing here." : "You may not do that." });
        return;
      }
      const { id } = req.params;
      const outcome = await withTransaction(async (client) => {
        return withLedgerLock(client, async () => {
          const r = await fetchReservationClient(client, id!);
          if (!r || !r.attendee_email || r.attendee_email.toLowerCase() !== account.email.toLowerCase()) {
            return { code: "not_found" as const };
          }
          if (r.attendee_accepted) return { code: "already" as const };
          const { rows: attending } = await client.query(
            `SELECT id FROM reservations
             WHERE attendee_email = $1 AND attendee_accepted = true AND id <> $2
               AND state IN ('held','deposit_paid','paid_in_full','checked_in_day1','checked_in_day2','certificate_issued')`,
            [account.email, id]
          );
          if (attending.length > 0) return { code: "already_attending" as const };
          await client.query("UPDATE reservations SET attendee_accepted = TRUE WHERE id = $1", [id]);
          return { code: "ok" as const };
        });
      });
      if (outcome.code === "not_found") {
        res.status(404).json({ error: "not_found", message: "Nothing here." });
        return;
      }
      if (outcome.code === "already_attending") {
        res.status(409).json({ error: "already_attending", message: "You already attend a seat." });
        return;
      }
      const row = await fetchReservation(id!);
      res.json({ reservation: row ? await reservationWithDocs(row) : null });
    } catch (e) {
      next(e);
    }
  });

  const upload = (kind: "licence" | "passport") => {
    return async (req: Request, res: import("express").Response, next: (e: unknown) => void) => {
      try {
        const account = await requireAccount(req);
        const r = await fetchReservation(req.params.id!);
        const notAttendee = !r || !r.attendee_accepted || !r.attendee_email || r.attendee_email.toLowerCase() !== account.email.toLowerCase();
        if (notAttendee) {
          const status = account.role === "practitioner" || account.role === "clinic" ? 404 : 403;
          res.status(status).json({ error: status === 404 ? "not_found" : "forbidden", message: status === 404 ? "Nothing here." : "You may not do that." });
          return;
        }
        if (kind === "licence" && r!.licence_status === "matched") {
          res.status(409).json({ error: "licence_locked", message: "This licence is already matched." });
          return;
        }
        const outcome = await readUpload(req);
        if (outcome.status !== 200) {
          res.status(outcome.status).json(outcome.body);
          return;
        }
        const fieldErrors = validateUploadFields(kind, outcome.fields ?? {});
        if (Object.keys(fieldErrors).length > 0) {
          res.status(422).json({ error: "validation", message: "Some fields need attention.", errors: fieldErrors });
          return;
        }
        // File size beyond the per-file limit was caught in the stream; but the
        // whole-request bytes decide payload_too_large.
        if (outcome.file!.length > FILE_LIMIT) {
          res.status(413).json({ error: "file_too_large", message: "Files must be 10,000,000 bytes or smaller." });
          return;
        }
        const detected = detectFileType(outcome.file!);
        if (!detected) {
          res.status(415).json({ error: "unsupported_file_type", message: "Upload a PDF, JPEG or PNG file." });
          return;
        }
        const suffix = detected === "pdf" ? "pdf" : detected === "jpeg" ? "jpg" : "png";
        const contentType = detected === "pdf" ? "application/pdf" : detected === "jpeg" ? "image/jpeg" : "image/png";
        const key = kind === "licence"
          ? `licences/${r!.id}/${randomId()}.${suffix}`
          : `passports/${r!.id}/${randomId()}.${suffix}`;
        try {
          await ctx.s3.put(key, outcome.file!, contentType);
        } catch {
          res.status(503).json({ error: "storage_unavailable", message: "Uploads are unavailable right now." });
          return;
        }
        if (kind === "licence") {
          await query(
            `UPDATE reservations SET licence_status = 'submitted', licence_number = $2, licence_state = $3, licence_object_key = $4 WHERE id = $1`,
            [r!.id, outcome.fields!["licence_number"], outcome.fields!["licence_state"], key]
          );
        } else {
          await query(
            `UPDATE reservations SET passport_status = 'submitted', passport_full_name = $2, passport_nationality = $3, passport_number = $4, passport_object_key = $5 WHERE id = $1`,
            [r!.id, outcome.fields!["full_name"], outcome.fields!["nationality"], outcome.fields!["passport_number"], key]
          );
        }
        const row = await fetchReservation(r!.id);
        res.status(201).json({ reservation: row ? await reservationWithDocs(row) : null });
      } catch (e) {
        next(e);
      }
    };
  };

  router.post("/reservations/:id/licence", upload("licence"));
  router.post("/reservations/:id/passport", upload("passport"));

  // Licence metadata with a short-lived link — attendee and registrar only.
  router.get("/reservations/:id/licence", async (req, res, next) => {
    try {
      const account = await requireAccount(req);
      const r = await fetchReservation(req.params.id!);
      if (!r || !r.licence_object_key) {
        res.status(404).json({ error: "not_found", message: "Nothing here." });
        return;
      }
      const rel = relationship(r, account);
      if (!(rel.isAttendee || account.role === "registrar")) {
        const status = rel.isBuyer ? 404 : 403;
        res.status(status).json({ error: status === 404 ? "not_found" : "forbidden", message: status === 404 ? "Nothing here." : "You may not do that." });
        return;
      }
      const url = await ctx.s3.presign(r.licence_object_key, 60);
      res.json({
        licence_number: r.licence_number,
        licence_state: r.licence_state_name,
        status: r.licence_status,
        url,
        expires_in: 60,
      });
    } catch (e) {
      next(e);
    }
  });

  router.get("/reservations/:id/passport", async (req, res, next) => {
    try {
      const account = await requireAccount(req);
      const r = await fetchReservation(req.params.id!);
      if (!r || !r.passport_object_key) {
        res.status(404).json({ error: "not_found", message: "Nothing here." });
        return;
      }
      const rel = relationship(r, account);
      if (!(rel.isAttendee || account.role === "registrar")) {
        const status = rel.isBuyer ? 404 : 403;
        res.status(status).json({ error: status === 404 ? "not_found" : "forbidden", message: status === 404 ? "Nothing here." : "You may not do that." });
        return;
      }
      const url = await ctx.s3.presign(r.passport_object_key, 60);
      res.json({
        full_name: r.passport_full_name,
        nationality: r.passport_nationality,
        passport_number: r.passport_number,
        url,
        expires_in: 60,
      });
    } catch (e) {
      next(e);
    }
  });

  // GET /api/reservations/{id}/documents/{kind}
  router.get("/reservations/:id/documents/:kind", async (req, res, next) => {
    try {
      const account = await requireAccount(req);
      const kind = req.params.kind!;
      const allowed = ["deposit-receipt", "balance-receipt", "full-receipt", "upgrade-receipt", "visa-letter", "certificate"];
      if (!allowed.includes(kind)) {
        res.status(404).json({ error: "not_found", message: "Nothing here." });
        return;
      }
      const r = await fetchReservation(req.params.id!);
      if (!r) {
        res.status(404).json({ error: "not_found", message: "Nothing here." });
        return;
      }
      const rel = relationship(r, account);
      const receipts = kind.endsWith("-receipt");
      let maySee: boolean;
      if (receipts) maySee = rel.isBuyer || account.role === "registrar";
      else maySee = rel.isAttendee || account.role === "registrar";
      if (!maySee) {
        const status = rel.isBuyer || rel.isAttendee ? 404 : account.role === "practitioner" || account.role === "clinic" ? 404 : 403;
        res.status(status).json({ error: status === 404 ? "not_found" : "forbidden", message: status === 404 ? "Nothing here." : "You may not do that." });
        return;
      }
      const { rows } = await query<{ object_key: string }>(
        "SELECT object_key FROM documents WHERE reservation_id = $1 AND kind = $2",
        [r.id, kind]
      );
      if (!rows[0]) {
        res.status(404).json({ error: "not_found", message: "Nothing here." });
        return;
      }
      const url = await ctx.s3.presign(rows[0].object_key, 60);
      res.json({ url, expires_in: 60 });
    } catch (e) {
      next(e);
    }
  });

  // GET /api/groups/{id}/documents/invoice — buyer, registrar.
  router.get("/groups/:id/documents/invoice", async (req, res, next) => {
    try {
      const account = await requireAccount(req);
      const { rows } = await query<{ buyer_id: string }>("SELECT buyer_id FROM groups WHERE id = $1", [req.params.id]);
      const g = rows[0];
      if (!g || (g.buyer_id !== account.id && account.role !== "registrar")) {
        const status = account.role === "clinic" ? 404 : 403;
        res.status(status).json({ error: status === 404 ? "not_found" : "forbidden", message: status === 404 ? "Nothing here." : "You may not do that." });
        return;
      }
      const { rows: doc } = await query<{ object_key: string }>(
        "SELECT object_key FROM documents WHERE reservation_id = $1 AND kind = 'invoice'",
        [req.params.id]
      );
      if (!doc[0]) {
        res.status(404).json({ error: "not_found", message: "Nothing here." });
        return;
      }
      const url = await ctx.s3.presign(doc[0].object_key, 60);
      res.json({ url, expires_in: 60 });
    } catch (e) {
      next(e);
    }
  });

  return router;
}
