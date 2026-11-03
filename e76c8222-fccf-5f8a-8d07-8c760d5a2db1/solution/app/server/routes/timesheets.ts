// Timesheets: signed submission, the approval queue, atomic approval, and the signed PDF.
import { randomUUID } from "node:crypto";
import type { QueuedTimesheet } from "../../shared/api.js";
import type { Setting, TimesheetStatus } from "../../shared/domain.js";
import { agencyDate, agencyTime } from "../../shared/time.js";
import { audit } from "../audit.js";
import { chargeAccount, earlierCharge, postNewCharge, timesheetChargeKey, timesheetChargeTerms, timesheetDescription } from "../billing.js";
import { one, pool, rows, transaction } from "../db.js";
import { amountCents, billedHundredths, billingStatus, derivedStatus, isCancelled } from "../domain/rules.js";
import { timesheetFields } from "../domain/validation.js";
import { jobOf, timesheetApprovedMail } from "../emails.js";
import { ApiError, invalid } from "../errors.js";
import { json, route } from "../http.js";
import { idempotent } from "../idempotency.js";
import { deadlineFromNow } from "../killbill.js";
import { formatCents, formatHundredths } from "../money.js";
import { enqueue, kickOutbox } from "../outbox.js";
import { textPdf } from "../pdf.js";
import { deleteObject, getObject, putObject } from "../storage.js";
import { observe, persistCompletion } from "../sweep.js";
import { REQUEST_SELECT, refOf, type RequestRow } from "../views.js";
import { idParam, rateOf, requesterEmails } from "./common.js";

route("POST", "/api/seats/:id/timesheet", ["interpreter"], async (ctx) => {
  const seatId = idParam(ctx, "id");
  const seat = await one<{ request_id: string; interpreter_id: string | null }>(
    pool,
    `SELECT s.request_id, o.interpreter_id FROM seats s LEFT JOIN offers o ON o.seat_id = s.id AND o.status = 'accepted' WHERE s.id = $1`,
    [seatId],
  );
  // Another interpreter's seat reads as missing, as other organisations' records do.
  if (!seat || seat.interpreter_id !== ctx.user.id) throw new ApiError("not_found");
  return idempotent(ctx, "timesheet.submit", seatId, async () => {
    const fields = timesheetFields(ctx.body);
    const id = randomUUID();
    const billed = billedHundredths(fields.actualStart, fields.actualEnd);
    await transaction(async (client) => {
      const request = await one<RequestRow>(client, `${REQUEST_SELECT} WHERE r.id = $1 FOR UPDATE OF r`, [seat.request_id]);
      if (!request) throw new ApiError("not_found");
      if (isCancelled(request.status)) throw new ApiError("invalid_transition", { from: request.status });
      if (request.end_at.getTime() > Date.now()) throw new ApiError("not_yet_ended");
      const existing = await one(client, "SELECT 1 FROM timesheets WHERE seat_id = $1", [seatId]);
      if (existing) throw new ApiError("already_submitted");
      await client.query(
        `INSERT INTO timesheets (id, seat_id, interpreter_id, actual_start, actual_end, signature_name, billed_hundredths, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'submitted')`,
        [id, seatId, ctx.user.id, fields.actualStart, fields.actualEnd, fields.signatureName, billed],
      );
      await audit(client, {
        actorId: ctx.user.id,
        action: "timesheet.submitted",
        entity: "timesheet",
        entityId: id,
        requestId: request.id,
        from: null,
        to: "submitted",
        detail: { seat_id: seatId, billed_hours: formatHundredths(billed) },
      });
    });
    return json(201, {
      timesheet: {
        id,
        status: "submitted",
        actual_start: fields.actualStart.toISOString(),
        actual_end: fields.actualEnd.toISOString(),
        billed_hours: formatHundredths(billed),
      },
    });
  });
});

interface SheetRow {
  id: string;
  seat_id: string;
  request_id: string;
  ref_no: number;
  org_id: string;
  interpreter_id: string;
  interpreter_name: string;
  actual_start: Date;
  actual_end: Date;
  signature_name: string;
  billed_hundredths: number;
  status: TimesheetStatus;
  setting: Setting;
}

const SHEET_SELECT = `
  SELECT t.id, t.seat_id, s.request_id, r.ref_no, r.org_id, t.interpreter_id, u.name AS interpreter_name,
         t.actual_start, t.actual_end, t.signature_name, t.billed_hundredths, t.status, r.setting
  FROM timesheets t JOIN seats s ON s.id = t.seat_id JOIN requests r ON r.id = s.request_id JOIN users u ON u.id = t.interpreter_id`;

route("GET", "/api/timesheets", ["billing"], async (ctx) => {
  const status = ctx.url.searchParams.get("status");
  if (status !== null && status !== "submitted" && status !== "approved") throw invalid({ status: "Use submitted or approved." });
  const found = await rows<SheetRow>(pool, `${SHEET_SELECT} WHERE ($1::text IS NULL OR t.status = $1) ORDER BY t.submitted_at, t.id`, [status]);
  const timesheets: QueuedTimesheet[] = found.map((t) => ({
    id: t.id,
    ref: refOf(t.ref_no),
    request_id: t.request_id,
    org_id: t.org_id,
    interpreter: { id: t.interpreter_id, name: t.interpreter_name },
    actual_start: t.actual_start.toISOString(),
    actual_end: t.actual_end.toISOString(),
    billed_hours: formatHundredths(t.billed_hundredths),
    status: t.status,
  }));
  return json(200, { timesheets });
});

const stamp = (instant: Date): string => `${agencyDate(instant)} ${agencyTime(instant)} Eastern Time`;

function signedPdf(sheet: SheetRow, request: RequestRow, rateCents: number, amount: number, approver: string, approvedAt: Date): Buffer {
  return textPdf(`Signed timesheet ${refOf(sheet.ref_no)}`, [
    `Organisation: ${request.org_name}`,
    `Assignment: ${request.title}`,
    `Location: ${request.location}`,
    `Interpreter: ${sheet.interpreter_name}`,
    `Actual start: ${stamp(sheet.actual_start)}`,
    `Actual end: ${stamp(sheet.actual_end)}`,
    `Billed hours: ${formatHundredths(sheet.billed_hundredths)}`,
    `Hourly rate: $${formatCents(rateCents)}`,
    `Amount: $${formatCents(amount)}`,
    `Signed: ${sheet.signature_name}`,
    `Approved by ${approver} on ${stamp(approvedAt)}`,
  ]);
}

const pdfKey = (requestId: string, timesheetId: string): string => `timesheets/${requestId}/${timesheetId}.pdf`;

route("POST", "/api/timesheets/:id/approve", ["billing"], async (ctx) => {
  const id = idParam(ctx, "id");
  const exists = await one(pool, "SELECT 1 FROM timesheets WHERE id = $1", [id]);
  if (!exists) throw new ApiError("not_found");
  return idempotent(ctx, "timesheet.approve", id, async () => {
    await observe();
    const done = await transaction(async (client) => {
      const head = await one<{ request_id: string }>(client, "SELECT s.request_id FROM timesheets t JOIN seats s ON s.id = t.seat_id WHERE t.id = $1", [id]);
      const request = await one<RequestRow>(client, `${REQUEST_SELECT} WHERE r.id = $1 FOR UPDATE OF r`, [head?.request_id]);
      const sheet = await one<SheetRow>(client, `${SHEET_SELECT} WHERE t.id = $1 FOR UPDATE OF t`, [id]);
      if (!request || !sheet) throw new ApiError("not_found");
      if (sheet.status !== "submitted") throw new ApiError("invalid_transition", { from: sheet.status });
      const key = timesheetChargeKey(id);
      const deadline = deadlineFromNow();
      const earlier = await earlierCharge(request.org_id, key, deadline);
      // A charge an earlier timed-out attempt left behind is adopted with its own rate and amount.
      const terms = earlier ? timesheetChargeTerms(earlier) : null;
      const rateCents = terms?.rateCents ?? (await rateOf(client, sheet.setting));
      const amount = terms?.amountCents ?? amountCents(sheet.billed_hundredths, rateCents);
      const account = await chargeAccount(request.org_id, deadline);
      const approvedAt = new Date();
      const objectKey = pdfKey(request.id, id);
      await putObject(objectKey, signedPdf(sheet, request, rateCents, amount, ctx.user.name, approvedAt), "application/pdf");
      let invoiceId = earlier?.invoiceId ?? "";
      if (!earlier) {
        try {
          invoiceId = await postNewCharge(account, key, amount, timesheetDescription(key, refOf(sheet.ref_no), sheet.interpreter_name, sheet.billed_hundredths, rateCents));
        } catch (error) {
          await deleteObject(objectKey).catch(() => undefined);
          throw error;
        }
      }
      await client.query(
        `UPDATE timesheets SET status = 'approved', hourly_rate_cents = $2, amount_cents = $3, killbill_invoice_id = $4, approved_by = $5, approved_at = $6
         WHERE id = $1`,
        [id, rateCents, amount, invoiceId, ctx.user.id, approvedAt],
      );
      await audit(client, {
        actorId: ctx.user.id,
        action: "timesheet.approved",
        entity: "timesheet",
        entityId: id,
        requestId: request.id,
        from: "submitted",
        to: "approved",
        detail: { amount: formatCents(amount), hourly_rate: formatCents(rateCents), killbill_invoice_id: invoiceId },
      });
      const counts = await one<{ seats: number; approved: number }>(
        client,
        `SELECT count(*)::int AS seats, count(t.id) FILTER (WHERE t.status = 'approved')::int AS approved
         FROM seats s LEFT JOIN timesheets t ON t.seat_id = s.id WHERE s.request_id = $1`,
        [request.id],
      );
      let status = derivedStatus(request.status, request.end_at, approvedAt);
      // The sweep skips rows another transaction holds; record a completion it could not.
      if (status === "completed" && request.status === "staffed") await persistCompletion(client, request.id);
      if (status === "completed" && counts && billingStatus(counts.approved, counts.seats) === "invoiced") {
        await client.query("UPDATE requests SET status = 'invoiced' WHERE id = $1", [request.id]);
        await audit(client, {
          actorId: ctx.user.id,
          action: "request.status_changed",
          entity: "request",
          entityId: request.id,
          requestId: request.id,
          from: "completed",
          to: "invoiced",
        });
        status = "invoiced";
      }
      for (const to of await requesterEmails(client, request.org_id)) {
        await enqueue(client, timesheetApprovedMail(to, jobOf(request), sheet.interpreter_name, formatHundredths(sheet.billed_hundredths), formatCents(amount)));
      }
      return { rateCents, amount, invoiceId, billed: sheet.billed_hundredths, ref: refOf(request.ref_no), status };
    });
    kickOutbox();
    return json(200, {
      timesheet: {
        id,
        status: "approved",
        billed_hours: formatHundredths(done.billed),
        hourly_rate: formatCents(done.rateCents),
        amount: formatCents(done.amount),
        killbill_invoice_id: done.invoiceId,
      },
      request: { ref: done.ref, status: done.status },
    });
  });
});

route("GET", "/api/timesheets/:id/pdf", "signed-in", async (ctx) => {
  const id = idParam(ctx, "id");
  const sheet = await one<{ request_id: string; org_id: string; interpreter_id: string; status: TimesheetStatus }>(
    pool,
    `SELECT s.request_id, r.org_id, t.interpreter_id, t.status FROM timesheets t JOIN seats s ON s.id = t.seat_id JOIN requests r ON r.id = s.request_id
     WHERE t.id = $1`,
    [id],
  );
  const user = ctx.user;
  const allowed =
    sheet &&
    sheet.status === "approved" &&
    (user.role === "billing" || (user.role === "requester" && user.org_id === sheet.org_id) || (user.role === "interpreter" && user.id === sheet.interpreter_id));
  if (!sheet || !allowed) throw new ApiError("not_found");
  const bytes = await getObject(pdfKey(sheet.request_id, id));
  if (!bytes) throw new ApiError("not_found");
  return {
    status: 200,
    bytes,
    headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="timesheet-${id}.pdf"` },
  };
});
