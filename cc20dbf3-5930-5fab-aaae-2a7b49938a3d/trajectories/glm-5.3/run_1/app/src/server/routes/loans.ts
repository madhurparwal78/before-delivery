import { Router, sendJson, readString, requireUser, requireStaff, requireFounder } from "../http";
import { ApiError, validation, notFound, conflict, invalidTransition, settlementMismatch, outage, FIELD_COPY } from "../errors";
import { AppServices } from "../routes";
import { withTransaction, lockKeys, acquireSessionLocks, releaseSessionLocks } from "../db";
import { readCalendar } from "../domain/library";
import { activeSpansForItem, isFreeForRange, countFreeForRange } from "../domain/spans";
import { isBorrowingPaused, activeCount, maxActivePerMember } from "../domain/borrowing";
import { holdView, loanView, LoanRow, HoldRow } from "../domain/views";
import { selectHoldById } from "../domain/holds";
import { selectLoanById, selectLoanPage } from "../domain/loans";
import { selectLedger, insertLedgerEntry } from "../domain/ledger";
import { queueEmail } from "../email";
import { formatLocalTime, formatIso, localDate, parseDate, dateDiff } from "../time";
import { isOpenDay, closingInstant, lateDays, lateFeeCents } from "../calendar";
import { randomUuid } from "../config";
import { beginIdempotent, storeIdempotentResponse, releaseIdempotencyMarker } from "../idempotency";
import { encodeCursor, decodeCursor, readCursorSecret } from "../paging";
import { requireIdempotencyKey, sendRawJson, statusWordOfHold } from "./holds";
import { stageForLoanStatus, countPhotosForStage, PHOTO_LIMIT, PHOTO_MAX_BYTES, detectImageType } from "../domain/photos";
import { formatMoney } from "../money";

const BILLING_DOWN_LEND =
  "Billing is offline, so items with a deposit can't be lent right now. Items without a deposit still lend.";
const BILLING_DOWN_SETTLE =
  "Billing is offline, so this loan can't be settled yet. Try again with the same damage charge once billing is back.";
const PHOTO_STORAGE_DOWN = "Photo storage is offline. The loan is saved; add photos when it's back.";

export function loanRoutes(router: Router, services: AppServices): void {
  const { pool, killbill, photos } = services;

  const loanVisibleTo = async (loanId: string, user: { id: string; role: string }): Promise<LoanRow> => {
    const calendar = await readCalendar(pool);
    const client = await pool.connect();
    try {
      const loan = await selectLoanById(client, loanId, calendar);
      if (loan === null) throw notFound();
      if (user.role === "member" && loan.member_id !== user.id) throw notFound();
      return loan;
    } finally {
      client.release();
    }
  };

  const loanJson = async (loan: LoanRow): Promise<Record<string, unknown>> => {
    await readCalendar(pool);
    return loanView(loan, new Date());
  };

  router.add("POST", "/api/loans", async (ctx) => {
    const user = requireStaff(ctx);
    const key = requireIdempotencyKey(ctx);
    const body = (await ctx.json()) as Record<string, unknown>;
    const calendar = await readCalendar(pool);

    if (typeof body.hold_id === "string" && Object.keys(body).length === 1) {
      await checkoutFromHold(ctx, user, key, body.hold_id, services);
      return;
    }

    await walkIn(ctx, user, key, body, services, calendar);
  });

  router.add("GET", "/api/loans", async (ctx) => {
    const user = requireUser(ctx);
    const { rows, nextCursor } = await loanPageFor(pool, ctx, user);
    sendJson(ctx, 200, {
      loans: rows.map((row) => loanView(row, new Date())),
      next_cursor: nextCursor === null ? null : encodeCursor(await readCursorSecret(pool), nextCursor),
    });
  });

  router.add("GET", "/api/loans/:loanId", async (ctx) => {
    const user = requireUser(ctx);
    const loan = await loanVisibleTo(ctx.params.loanId, user);
    sendJson(ctx, 200, { loan: await loanJson(loan) });
  });

  router.add("POST", "/api/loans/:loanId/renewal", async (ctx) => {
    const user = requireUser(ctx);
    const key = requireIdempotencyKey(ctx);
    const body = (await ctx.json()) as Record<string, unknown>;
    const dueDate = readString(body.due_date);
    const calendar = await readCalendar(pool);
    const parsed = dueDate !== null ? parseDate(dueDate) : null;
    if (parsed === null) throw validation({ due_date: FIELD_COPY.renewal_due_date });

    await withTransaction(pool, async (client) => {
      const initial = await selectLoanById(client, ctx.params.loanId, calendar);
      if (initial === null || (user.role === "member" && initial.member_id !== user.id)) throw notFound();
      await lockKeys(client, [`loan:${initial.id}`, `item:${initial.item_id}`]);

      const outcome = await beginIdempotent(client, user, key, "POST", ctx.path, ctx.rawBody);
      if (outcome.replay !== null) {
        sendRawJson(ctx, outcome.replay.status, outcome.replay.body);
        return;
      }

      // Re-read under the lock so racing requests see the committed winner.
      const loan = (await selectLoanById(client, ctx.params.loanId, calendar)) as LoanRow;
      if (loan.status !== "out") {
        throw invalidTransition("loan", statusWordOfLoan(loan));
      }
      if (loan.renewed_at !== null) throw conflict("renewal_used");
      if (await isBorrowingPausedFor(client, loan.member_id, loan.id)) throw conflict("borrowing_paused");
      const newDue = (parsed as { iso: string }).iso;
      if (!isOpenDay(calendar, newDue) || newDue <= loan.due_date || dateDiff(loan.due_date, newDue) > 7) {
        throw validation({ due_date: FIELD_COPY.renewal_due_date });
      }
      const units = (await client.query("SELECT id FROM units WHERE id = $1", [loan.unit_id])).rows;
      if (units.length === 0) throw notFound();
      const spans = (await activeSpansForItem(client, loan.item_id)).filter(
        (span) => span.record_id !== loan.id,
      );
      if (!isFreeForRange(spans.filter((span) => span.unit_id === loan.unit_id), nextDay(loan.due_date), newDue)) {
        throw conflict("unit_busy");
      }
      await client.query("UPDATE loans SET due_date = $2, renewed_at = now() WHERE id = $1", [loan.id, newDue]);
      const renewed = await selectLoanById(client, loan.id, calendar);
      const renewBody = JSON.stringify({ loan: loanView(renewed as LoanRow, new Date()) });
      await storeIdempotentResponse(client, user, key, 200, renewBody);
      sendRawJson(ctx, 200, renewBody);
    });
  });

  router.add("POST", "/api/loans/:loanId/return", async (ctx) => {
    const user = requireStaff(ctx);
    const body = (await ctx.json()) as Record<string, unknown>;
    const returnedAtRaw = readString(body.returned_at);
    const calendar = await readCalendar(pool);
    const updated = await withTransaction(pool, async (client) => {
      await lockKeys(client, [`loan:${ctx.params.loanId}`]);
      const loan = (await selectLoanById(client, ctx.params.loanId, calendar)) as LoanRow;
      if (loan === null) throw notFound();
      let returnedAt = new Date();
      if (returnedAtRaw !== null) {
        const parsed = parseInstant(returnedAtRaw);
        if (parsed === null) throw validation({ returned_at: FIELD_COPY.returned_at });
        if (parsed.getTime() < loan.checked_out_at.getTime() || parsed.getTime() > Date.now()) {
          throw validation({ returned_at: FIELD_COPY.returned_at });
        }
        returnedAt = parsed;
      }
      if (loan.status !== "out") throw invalidTransition("loan", statusWordOfLoan(loan));
      const onTime = returnedAt.getTime() <= loan.due_at.getTime();
      const lateDates = onTime ? [] : lateDays(calendar, loan.due_date, returnedAt);
      await client.query(
        "UPDATE loans SET status = 'returned', returned_at = $2, on_time = $3, late_days = $4 WHERE id = $1",
        [loan.id, returnedAt, onTime, lateDates.length],
      );
      // The response is sent after commit so an immediate re-read sees the stored values.
      return selectLoanById(client, loan.id, calendar);
    });
    sendJson(ctx, 200, { loan: loanView(updated as LoanRow, new Date()) });
  });

  router.add("POST", "/api/loans/:loanId/inspection", async (ctx) => {
    requireStaff(ctx);
    const body = (await ctx.json()) as Record<string, unknown>;
    const outcome = readString(body.outcome);
    const note = readString(body.note) ?? "";
    const calendar = await readCalendar(pool);
    const updated = await withTransaction(pool, async (client) => {
      await lockKeys(client, [`loan:${ctx.params.loanId}`]);
      const loan = (await selectLoanById(client, ctx.params.loanId, calendar)) as LoanRow;
      if (loan === null) throw notFound();
      const fields: Record<string, string> = {};
      if (outcome !== "ok" && outcome !== "damaged") fields.outcome = FIELD_COPY.outcome;
      if (note.length > 500) {
        fields.note = outcome === "damaged" ? FIELD_COPY.note_damaged : FIELD_COPY.note_ok;
      } else if (outcome === "damaged" && note.length === 0) {
        fields.note = FIELD_COPY.note_damaged;
      }
      if (Object.keys(fields).length > 0) throw validation(fields);
      if (loan.status !== "returned") throw invalidTransition("loan", statusWordOfLoan(loan));
      await client.query(
        "INSERT INTO inspections (loan_id, outcome, note, inspected_at) VALUES ($1, $2, $3, now())",
        [loan.id, outcome, note],
      );
      await client.query("UPDATE loans SET status = 'inspected' WHERE id = $1", [loan.id]);
      return selectLoanById(client, loan.id, calendar);
    });
    sendJson(ctx, 200, { loan: loanView(updated as LoanRow, new Date()) });
  });

  router.add("POST", "/api/loans/:loanId/settlement", async (ctx) => {
    const user = requireFounder(ctx);
    const key = requireIdempotencyKey(ctx);
    const body = (await ctx.json()) as Record<string, unknown>;
    const damageCentsRaw = body.damage_cents;
    const calendar = await readCalendar(pool);
    if (typeof damageCentsRaw !== "number" || !Number.isInteger(damageCentsRaw)) {
      throw validation({ damage_cents: FIELD_COPY.damage_cents_range });
    }
    const damageCents = damageCentsRaw as number;

    // Settlement attempts for one loan are decided one after another, across
    // both phases, under a session-scoped lock on the loan.
    const client = await pool.connect();
    let markerOpen = false;
    try {
      await acquireSessionLocks(client, [`settlement:${ctx.params.loanId}`]);

      // Phase A: validate, replay or claim the key, and fix the damage charge.
      // The fixed charge survives a later billing failure by design.
      await client.query("BEGIN");
      const outcome = await beginIdempotent(client, user, key, "POST", ctx.path, ctx.rawBody);
      markerOpen = true;
      if (outcome.replay !== null) {
        await client.query("COMMIT");
        sendRawJson(ctx, outcome.replay.status, outcome.replay.body);
        return;
      }
      const loan = (await selectLoanById(client, ctx.params.loanId, calendar)) as LoanRow;
      if (loan === null) throw notFound();
      if (loan.inspection === null || loan.status !== "inspected") {
        throw invalidTransition("loan", statusWordOfLoan(loan));
      }
      if (damageCents < 0 || damageCents > loan.replacement_cents) {
        throw validation({ damage_cents: FIELD_COPY.damage_cents_range });
      }
      if (loan.inspection.outcome === "ok" && damageCents !== 0) {
        throw validation({ damage_cents: FIELD_COPY.damage_cents_ok });
      }
      const fixed = await client.query(
        "SELECT damage_cents FROM fixed_damage_charges WHERE loan_id = $1",
        [loan.id],
      );
      let fixedDamage = damageCents;
      if (fixed.rowCount !== null && fixed.rowCount > 0) {
        fixedDamage = fixed.rows[0].damage_cents as number;
        if (fixedDamage !== damageCents) {
          throw settlementMismatch(formatMoney(fixedDamage));
        }
      } else {
        await client.query(
          "INSERT INTO fixed_damage_charges (loan_id, damage_cents) VALUES ($1, $2)",
          [loan.id, damageCents],
        );
      }
      await client.query("COMMIT");
      markerOpen = false;

      // Billing records are written first; the settled status, ledger entries and
      // receipt email take effect together only once they all exist.
      const lateDates = loan.late_days === null ? [] : lateDays(calendar, loan.due_date, loan.returned_at as Date);
      const lateFee = lateFeeCents(calendar, lateDates, loan.replacement_cents);
      const damageFromDeposit = Math.min(fixedDamage, loan.deposit_cents);
      const extraDamage = fixedDamage - damageFromDeposit;
      const released = loan.deposit_cents - damageFromDeposit;
      const totalCharged = fixedDamage + lateFee;

      // Settlement needs billing only when it has a billing record to write.
      const needsBilling = released > 0 || extraDamage > 0 || lateFee > 0;
      if (needsBilling) {
        try {
          if (!(await killbill.probe())) throw new Error("probe");
          const account = await killbill.ensureAccountReady(loan.member_id, loan.member_name, loan.member_email);
          if (released > 0) {
            await killbill.recordRefund(
              account.accountId,
              `shedline-${loan.id}-deposit`,
              `shedline-${loan.id}-deposit-release`,
              released,
            );
          }
          if (extraDamage > 0) {
            await killbill.recordPurchase(
              account.accountId,
              `shedline-${loan.id}-extra-damage`,
              `shedline-${loan.id}-extra-damage`,
              extraDamage,
            );
          }
          if (lateFee > 0) {
            await killbill.recordPurchase(
              account.accountId,
              `shedline-${loan.id}-late-fee`,
              `shedline-${loan.id}-late-fee`,
              lateFee,
            );
          }
        } catch {
          await client.query("BEGIN");
          await releaseIdempotencyMarker(client, user, key);
          await client.query("COMMIT");
          throw outage("billing_unavailable", BILLING_DOWN_SETTLE);
        }
      }

      // Phase B: the settled status, ledger entries and one receipt email, together.
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO settlements (loan_id, deposit_cents, released_cents, damage_cents, damage_from_deposit_cents,
           extra_damage_cents, late_days, late_fee_cents, total_charged_cents, settled_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())`,
        [loan.id, loan.deposit_cents, released, fixedDamage, damageFromDeposit, extraDamage, lateDates.length, lateFee, totalCharged],
      );
      await client.query("UPDATE loans SET status = 'settled' WHERE id = $1", [loan.id]);
      if (released > 0) {
        insertLedgerEntry(client, { loanId: loan.id, itemId: loan.item_id, kind: "deposit_release", amountCents: -released });
      }
      if (damageFromDeposit > 0) {
        insertLedgerEntry(client, { loanId: loan.id, itemId: loan.item_id, kind: "damage_charge", amountCents: -damageFromDeposit });
      }
      if (extraDamage > 0) {
        insertLedgerEntry(client, { loanId: loan.id, itemId: loan.item_id, kind: "extra_damage", amountCents: extraDamage });
      }
      if (lateFee > 0) {
        insertLedgerEntry(client, { loanId: loan.id, itemId: loan.item_id, kind: "late_fee", amountCents: lateFee });
      }
      queueEmail(client, loan.member_email, {
        kind: "settlement_receipt",
        itemName: loan.item_name,
        unitLabel: loan.unit_label,
        lines: [
          `Deposit held: ${formatMoney(loan.deposit_cents)}`,
          `Deposit released: ${formatMoney(released)}`,
          `Damage charge: ${formatMoney(fixedDamage)}`,
          `Charged beyond deposit: ${formatMoney(extraDamage)}`,
          `Late fee: ${formatMoney(lateFee)} (${lateDates.length} late days)`,
          `Total charged: ${formatMoney(totalCharged)}`,
        ],
      });
      const settled = (await selectLoanById(client, loan.id, calendar)) as LoanRow;
      const settleBody = JSON.stringify({ settlement: settled.settlement, loan: loanView(settled, new Date()) });
      await storeIdempotentResponse(client, user, key, 201, settleBody);
      await client.query("COMMIT");
      sendRawJson(ctx, 201, settleBody);
    } catch (error) {
      // A refused request frees the key for a brand-new attempt.
      if (markerOpen) {
        try {
          await client.query("ROLLBACK");
        } catch { /* the connection is broken; nothing further can be done */ }
      } else {
        try {
          await client.query("BEGIN");
          await releaseIdempotencyMarker(client, user, key);
          await client.query("COMMIT");
        } catch { /* nothing to free if the attempt never claimed the key */ }
      }
      throw error;
    } finally {
      try {
        await releaseSessionLocks(client, [`settlement:${ctx.params.loanId}`]);
      } catch { /* the connection is returned below regardless */ }
      client.release();
    }
  });

  router.add("GET", "/api/loans/:loanId/receipt", async (ctx) => {
    const user = requireUser(ctx);
    const loan = await loanVisibleTo(ctx.params.loanId, user);
    if (loan.settlement === null) throw conflict("not_settled");
    sendJson(ctx, 200, {
      receipt: {
        ...loan.settlement,
        item: { id: loan.item_id, name: loan.item_name },
        unit: { id: loan.unit_id, label: loan.unit_label, lane_index: loan.lane_index },
        member: { id: loan.member_id, name: loan.member_name },
      },
    });
  });

  router.add("POST", "/api/loans/:loanId/photos", async (ctx) => {
    requireStaff(ctx);
    const calendar = await readCalendar(pool);
    const parts = ctx.multipart;
    if (parts === null || parts.photo === undefined) throw validation({ photo: FIELD_COPY.photo });
    const bytes = parts.photo.bytes;
    const detected = detectImageType(bytes);
    if (detected === null) throw new ApiError(415, "unsupported_photo");
    if (bytes.length > PHOTO_MAX_BYTES) throw new ApiError(413, "photo_too_large");

    const photo = await withTransaction(pool, async (client) => {
      await lockKeys(client, [`loan:${ctx.params.loanId}`]);
      const loan = (await selectLoanById(client, ctx.params.loanId, calendar)) as LoanRow;
      if (loan === null) throw notFound();
      const stage = stageForLoanStatus(loan.status);
      if (stage === null) throw invalidTransition("loan", statusWordOfLoan(loan));
      const count = await countPhotosForStage(client, loan.id, stage);
      if (count >= PHOTO_LIMIT) throw conflict("photo_limit");
      const photoId = randomUuid();
      const key = photos.objectKey(loan.id, stage, photoId, detected.extension);
      try {
        await photos.put(key, detected.contentType, bytes);
      } catch {
        throw outage("photo_storage_unavailable", PHOTO_STORAGE_DOWN);
      }
      await client.query(
        "INSERT INTO photos (id, loan_id, stage, content_type, size_bytes) VALUES ($1, $2, $3, $4, $5)",
        [photoId, loan.id, stage, detected.contentType, bytes.length],
      );
      // The response is sent after commit so an immediate panel re-read sees the record.
      return {
        id: photoId,
        stage,
        content_type: detected.contentType,
        size_bytes: bytes.length,
        url: `/api/loans/${loan.id}/photos/${photoId}`,
      };
    });
    sendJson(ctx, 201, { photo });
  });

  router.add("GET", "/api/loans/:loanId/photos/:photoId", async (ctx) => {
    const user = requireUser(ctx);
    const loan = await loanVisibleTo(ctx.params.loanId, user);
    const photo = loan.photos.find((candidate) => candidate.id === ctx.params.photoId);
    if (photo === undefined) throw notFound();
    const stage = photo.stage;
    const key = photos.objectKey(loan.id, stage, photo.id, extensionFor(photo.content_type));
    let bytes: Buffer;
    try {
      bytes = await photos.get(key);
    } catch {
      throw outage("photo_storage_unavailable", "Photo storage is offline. Try again in a moment.");
    }
    ctx.res.writeHead(200, {
      "Content-Type": photo.content_type,
      "Content-Length": bytes.length,
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    });
    ctx.res.end(bytes);
  });

  router.add("GET", "/api/ledger", async (ctx) => {
    requireFounder(ctx);
    const loanId = ctx.query.get("loan_id") ?? undefined;
    const client = await pool.connect();
    try {
      const { entries, depositsHeldCents } = await selectLedger(client, loanId);
      sendJson(ctx, 200, {
        entries: entries.map((entry) => ({
          id: entry.id,
          loan_id: entry.loan_id,
          item: { id: entry.item_id, name: entry.item_name },
          kind: entry.kind,
          amount_cents: entry.amount_cents,
          created_at: formatIso(entry.created_at),
        })),
        deposits_held_cents: depositsHeldCents,
      });
    } finally {
      client.release();
    }
  });

  router.add("GET", "/api/counter/status", async (ctx) => {
    requireStaff(ctx);
    const [billing, storage] = await Promise.all([killbill.probe(), photos.probe()]);
    sendJson(ctx, 200, {
      billing: billing ? "up" : "down",
      photo_storage: storage ? "up" : "down",
      checked_at: formatIso(new Date()),
    });
  });
}

function extensionFor(contentType: string): string {
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  return "jpg";
}

function nextDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const result = new Date(Date.UTC(y, m - 1, d + 1));
  return `${result.getUTCFullYear()}-${String(result.getUTCMonth() + 1).padStart(2, "0")}-${String(result.getUTCDate()).padStart(2, "0")}`;
}

function parseInstant(value: string): Date | null {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?Z$/.exec(value);
  if (match === null) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function statusWordOfLoan(loan: LoanRow): string {
  const now = new Date();
  if (loan.status === "out") {
    return now.getTime() > loan.due_at.getTime() ? "overdue" : "out";
  }
  return loan.status;
}

async function isBorrowingPausedFor(client: import("pg").PoolClient, memberId: string, excludeLoanId: string): Promise<boolean> {
  const result = await client.query(
    `SELECT 1 FROM loans l, library lib
      WHERE l.member_id = $1 AND l.status = 'out' AND l.id::text <> $2
        AND now() > ((l.due_date::text || ' ' || lib.closing_time)::timestamp AT TIME ZONE lib.time_zone)
      LIMIT 1`,
    [memberId, excludeLoanId],
  );
  return result.rowCount !== null && result.rowCount > 0;
}

async function checkoutFromHold(ctx: import("../http").Ctx, user: import("../http").SessionUser, key: string, holdId: string, services: AppServices): Promise<void> {
  const { pool, killbill } = services;
  const calendar = await readCalendar(pool);
  await withTransaction(pool, async (client) => {
    const outcome = await beginIdempotent(client, user, key, "POST", "/api/loans", ctx.rawBody);
    if (outcome.replay !== null) {
      sendRawJson(ctx, outcome.replay.status, outcome.replay.body);
      return;
    }
    const initial = await selectHoldById(client, holdId);
    if (initial === null) throw validation({ hold_id: FIELD_COPY.hold_id });
    await lockKeys(client, [`hold:${initial.id}`, `item:${initial.item_id}`, `loan-member:${initial.member_id}`]);

    // Re-read under the lock so a racing checkout, cancel or expiry is seen.
    const hold = (await selectHoldById(client, holdId)) as HoldRow;
    if (hold.status !== "ready") throw invalidTransition("hold", statusWordOfHold(hold));
    if (hold.pickup_deadline !== null && hold.pickup_deadline.getTime() <= Date.now()) throw conflict("hold_expired");
    if (await isBorrowingPaused(client, hold.member_id)) throw conflict("borrowing_paused");
    const item = (await client.query("SELECT id, deposit_cents, replacement_cents FROM items WHERE id = $1", [hold.item_id])).rows[0];
    const checkoutDate = localDate(new Date(), calendar.timeZone);
    const spans = (await activeSpansForItem(client, hold.item_id)).filter((span) => span.record_id !== hold.id);
    if (!isFreeForRange(spans.filter((span) => span.unit_id === hold.unit_id), checkoutDate, hold.end_date)) {
      throw conflict("unit_busy");
    }
    const deposit = item.deposit_cents as number;
    if (deposit > 0 && !(await killbill.probe())) {
      throw outage("billing_unavailable", BILLING_DOWN_LEND);
    }
    const loanId = randomUuid();
    if (deposit > 0) {
      const member = (await client.query("SELECT name, email FROM users WHERE id = $1", [hold.member_id])).rows[0];
      try {
        const account = await killbill.ensureAccountReady(hold.member_id, member.name, member.email);
        await killbill.recordPurchase(
          account.accountId,
          `shedline-${loanId}-deposit`,
          `shedline-${loanId}-deposit-hold`,
          deposit,
        );
      } catch {
        throw outage("billing_unavailable", BILLING_DOWN_LEND);
      }
    }
    await client.query("UPDATE holds SET status = 'collected' WHERE id = $1", [hold.id]);
    await client.query(
      `INSERT INTO loans (id, item_id, unit_id, member_id, hold_id, status, checked_out_at, due_date, deposit_cents, replacement_cents)
       VALUES ($1, $2, $3, $4, $5, 'out', now(), $6, $7, $8)`,
      [loanId, hold.item_id, hold.unit_id, hold.member_id, hold.id, hold.end_date, deposit, item.replacement_cents],
    );
    if (deposit > 0) {
      insertLedgerEntry(client, { loanId, itemId: hold.item_id, kind: "deposit_hold", amountCents: deposit });
    }
    const loan = await selectLoanById(client, loanId, calendar);
    const body = JSON.stringify({ loan: loanView(loan as LoanRow, new Date()) });
    await storeIdempotentResponse(client, user, key, 201, body);
    sendRawJson(ctx, 201, body);
  });
}

async function walkIn(ctx: import("../http").Ctx, user: import("../http").SessionUser, key: string, body: Record<string, unknown>, services: AppServices, calendar: import("../calendar").LibraryCalendar): Promise<void> {
  const { pool, killbill } = services;
  const memberId = readString(body.member_id);
  const unitId = readString(body.unit_id);
  const dueDateRaw = readString(body.due_date);
  const checkedOutAtRaw = readString(body.checked_out_at);
  await withTransaction(pool, async (client) => {
    const outcome = await beginIdempotent(client, user, key, "POST", "/api/loans", ctx.rawBody);
    if (outcome.replay !== null) {
      sendRawJson(ctx, outcome.replay.status, outcome.replay.body);
      return;
    }
    const fields: Record<string, string> = {};
    if (memberId === null) fields.member_id = FIELD_COPY.member_id;
    if (unitId === null) fields.unit_id = FIELD_COPY.unit_id;
    if (dueDateRaw === null) fields.due_date = FIELD_COPY.due_date;
    if (Object.keys(fields).length > 0) throw validation(fields);

    const member = await client.query("SELECT id, name, email, role FROM users WHERE id = $1", [memberId]);
    if (member.rowCount === 0) throw validation({ member_id: FIELD_COPY.member_id });
    const unit = await client.query("SELECT id, item_id, label, lane_index FROM units WHERE id = $1", [unitId]);
    if (unit.rowCount === 0) throw validation({ unit_id: FIELD_COPY.unit_id });
    const item = (await client.query("SELECT id, deposit_cents, replacement_cents FROM items WHERE id = $1", [unit.rows[0].item_id])).rows[0];
    await lockKeys(client, [`item:${item.id}`, `member:${memberId}`]);

    let checkedOutAt = new Date();
    if (checkedOutAtRaw !== null) {
      const parsed = parseInstant(checkedOutAtRaw);
      if (parsed === null || parsed.getTime() > Date.now()) {
        throw validation({ checked_out_at: FIELD_COPY.checked_out_at });
      }
      checkedOutAt = parsed;
    }
    const backDate = localDate(checkedOutAt, calendar.timeZone);
    const dueParsed = parseDate(dueDateRaw as string);
    if (
      dueParsed === null ||
      !isOpenDay(calendar, dueParsed.iso) ||
      dueParsed.iso < backDate ||
      dateDiff(backDate, dueParsed.iso) > 7
    ) {
      throw validation({ due_date: FIELD_COPY.due_date });
    }
    if (await isBorrowingPaused(client, memberId as string)) throw conflict("borrowing_paused");
    const limit = await maxActivePerMember(client);
    if ((await activeCount(client, memberId as string)) + 1 > limit) throw conflict("borrowing_limit");
    const spans = await activeSpansForItem(client, item.id);
    if (!isFreeForRange(spans.filter((span) => span.unit_id === unitId), backDate, dueParsed.iso)) {
      throw conflict("unit_busy");
    }
    const deposit = item.deposit_cents as number;
    if (deposit > 0 && !(await killbill.probe())) {
      throw outage("billing_unavailable", BILLING_DOWN_LEND);
    }
    const loanId = randomUuid();
    if (deposit > 0) {
      try {
        const account = await killbill.ensureAccountReady(
          memberId as string,
          member.rows[0].name,
          member.rows[0].email,
        );
        await killbill.recordPurchase(
          account.accountId,
          `shedline-${loanId}-deposit`,
          `shedline-${loanId}-deposit-hold`,
          deposit,
        );
      } catch {
        throw outage("billing_unavailable", BILLING_DOWN_LEND);
      }
    }
    await client.query(
      `INSERT INTO loans (id, item_id, unit_id, member_id, hold_id, status, checked_out_at, due_date, deposit_cents, replacement_cents)
       VALUES ($1, $2, $3, $4, NULL, 'out', $5, $6, $7, $8)`,
      [loanId, item.id, unitId, memberId, checkedOutAt, dueParsed.iso, deposit, item.replacement_cents],
    );
    if (deposit > 0) {
      insertLedgerEntry(client, { loanId, itemId: item.id, kind: "deposit_hold", amountCents: deposit });
    }
    const loan = await selectLoanById(client, loanId, calendar);
    const loanBody = JSON.stringify({ loan: loanView(loan as LoanRow, new Date()) });
    await storeIdempotentResponse(client, user, key, 201, loanBody);
    sendRawJson(ctx, 201, loanBody);
  });
}

async function loanPageFor(pool: import("pg").Pool, ctx: import("../http").Ctx, user: { id: string; role: string }): Promise<{ rows: LoanRow[]; nextCursor: { k: string; i: string } | null }> {
  const limitParam = ctx.query.get("limit");
  let limit = 20;
  if (limitParam !== null) {
    const parsed = Number.parseInt(limitParam, 10);
    if (String(parsed) !== limitParam || parsed < 1 || parsed > 50) {
      throw validation({ limit: FIELD_COPY.limit });
    }
    limit = parsed;
  }
  const cursorParam = ctx.query.get("cursor");
  let before: { k: string; i: string } | null = null;
  if (cursorParam !== null) {
    const secret = await readCursorSecret(pool);
    const decoded = decodeCursor(secret, cursorParam);
    if (decoded === null) throw validation({ cursor: FIELD_COPY.cursor });
    before = decoded;
  }
  const statusParam = ctx.query.get("status");
  const calendar = await readCalendar(pool);
  const client = await pool.connect();
  try {
    return await selectLoanPage(client, calendar, {
      memberId: user.id,
      status: statusParam ?? undefined,
      limit,
      before,
      viewerIsMember: user.role === "member",
    });
  } finally {
    client.release();
  }
}
