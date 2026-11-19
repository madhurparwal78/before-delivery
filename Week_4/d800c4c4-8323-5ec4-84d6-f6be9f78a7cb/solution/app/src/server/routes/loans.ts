import { createHash } from "node:crypto";
import type pg from "pg";
import { config } from "../config.js";
import { one, pool, rows, transaction } from "../db.js";
import type { LoanStatus } from "../domain/board.js";
import { dueDateFor, loadCalendar, loadSettings, openDaysLate, today, type Calendar } from "../domain/calendar.js";
import { feeLines, lateFeeSoFar, recordFeeRules, type FeeRules, type Grade } from "../domain/fees.js";
import { membershipOf, membershipStatus } from "../domain/membership.js";
import { parseInstant } from "../domain/time.js";
import { ApiError, conflict, invalid, notFound, route, STAFF, type Ctx, type Fields, type Reply } from "../http/pipeline.js";
import type { UploadedFile } from "../http/multipart.js";
import { idFrom, pathId } from "../http/values.js";
import { raiseCharges } from "../providers/killbill.js";
import { queueMail } from "../providers/mail.js";
import { ProviderDown } from "../providers/status.js";
import { deletePhotoObject, putPhotoObject } from "../providers/storage.js";
import { loadCounts, loadFees, loadItems, loadLoans, type LoanView } from "../views.js";
import { kickMail } from "../workers.js";
import { promoteIfFree } from "./holds.js";
import { withBilling } from "./members.js";

const NOT_CHECKED_OUT = "This loan has not been checked out.";
const WAITING_FOR_PHOTO = "This check-in is waiting for its photo.";
const ALREADY_CHECKED_IN = "This loan is already checked in.";
const WRONG_PEG = "That peg belongs to a different tool.";
const CHECKIN_BILLING_DOWN = "Billing is down. This check-in was not saved; try again when it is back.";
const DAY = 86_400_000;

interface LoanRecord {
  id: number;
  ref: string;
  member_id: number;
  status: LoanStatus;
  checked_out_at: Date | null;
  item_ids: number[];
}

/** A loan the caller may see: staff see every loan, a member only their own; anything else is not found. */
async function findLoan(ctx: Ctx): Promise<LoanRecord> {
  const id = pathId(ctx.params.id);
  const loan =
    id === null
      ? undefined
      : await one<LoanRecord>(
          pool,
          `SELECT l.id, l.ref, l.member_id, l.status, l.checked_out_at,
                  array(SELECT item_id FROM loan_items WHERE loan_id = l.id ORDER BY position) AS item_ids
           FROM loans l WHERE l.id = $1`,
          [id],
        );
  if (!loan || (ctx.caller!.role === "member" && loan.member_id !== ctx.caller!.id)) throw notFound();
  return loan;
}

async function lockLoan(client: pg.PoolClient, id: number): Promise<LoanRecord & { due_date: string; fee_rules: FeeRules; returned_at: Date | null; recorded_open_days_late: number | null; requested_checked_out_at: Date | null }> {
  const [loan] = await rows<LoanRecord & { due_date: string; fee_rules: FeeRules; returned_at: Date | null; recorded_open_days_late: number | null; requested_checked_out_at: Date | null }>(
    client,
    `SELECT l.id, l.ref, l.member_id, l.status, l.checked_out_at, l.requested_checked_out_at, l.due_date, l.fee_rules,
            l.returned_at, l.recorded_open_days_late,
            array(SELECT item_id FROM loan_items WHERE loan_id = l.id ORDER BY position) AS item_ids
     FROM loans l WHERE l.id = $1 FOR UPDATE`,
    [id],
  );
  return loan!;
}

async function loanView(db: pg.PoolClient | typeof pool, id: number, calendar: Calendar, now: number): Promise<LoanView> {
  return (await loadLoans(db, { ids: [id] }, calendar, now))[0]!;
}

const SIGNATURES: Record<string, (data: Buffer) => boolean> = {
  "image/jpeg": (d) => d.length >= 3 && d[0] === 0xff && d[1] === 0xd8 && d[2] === 0xff,
  "image/png": (d) => d.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/webp": (d) => d.subarray(0, 4).toString("latin1") === "RIFF" && d.subarray(8, 12).toString("latin1") === "WEBP",
};

function capturedProblem(ctx: Ctx): string | null {
  const captured = parseInstant(ctx.multipart!.fields.captured_at);
  return captured === null || captured > ctx.now + 10 * 60_000 ? "Give the capture time as ISO 8601 with an offset, no later than now." : null;
}

function photoProblem(ctx: Ctx): string | null {
  const photo = ctx.multipart!.files.photo;
  return photo && SIGNATURES[photo.contentType]?.(photo.data) ? null : "Choose a JPEG, PNG or WebP photo.";
}

/** Adds the named problems in the endpoint's own field order. */
function collect(fields: Fields, checks: Array<[string, string | null]>): Fields {
  for (const [name, problem] of checks) if (problem) fields[name] = problem;
  return fields;
}

interface StoredPhoto {
  id: number;
  key: string;
}

/** Writes the photo object for a loan event; only ever called by the request that won the loan's transition. */
async function storePhoto(client: pg.PoolClient, loan: { id: number; ref: string }, event: "checkout" | "checkin", ctx: Ctx): Promise<StoredPhoto> {
  const photo = ctx.multipart!.files.photo as UploadedFile;
  const capturedText = ctx.multipart!.fields.captured_at!.trim();
  const [{ id }] = (await rows<{ id: number }>(client, `SELECT nextval('photos_id_seq')::int AS id`)) as [{ id: number }];
  const key = `loans/${loan.ref}/${event}/${id}`;
  await putPhotoObject(key, photo.data, photo.contentType, capturedText);
  await client.query(
    `INSERT INTO photos (id, loan_id, event, content_type, byte_size, sha256, captured_at, received_at, object_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, loan.id, event, photo.contentType, photo.data.length, createHash("sha256").update(photo.data).digest("hex"), new Date(parseInstant(capturedText)!), new Date(ctx.now), key],
  );
  return { id, key };
}

const dollars = (cents: number) => `${Math.floor(cents / 100).toLocaleString("en-US")}.${String(cents % 100).padStart(2, "0")}`;

/** A returned loan is complete once none of its parts is missing, and partial otherwise. */
async function returnStatus(client: pg.PoolClient, itemIds: readonly number[]): Promise<LoanStatus> {
  const missing = await one(client, `SELECT 1 FROM parts WHERE item_id = ANY($1) AND state = 'missing'`, [itemIds]);
  return missing ? "returned-partial" : "returned-complete";
}

/** Check-in and take-down need an out loan; anything else answers its published conflict. */
function requireOut(status: LoanStatus): void {
  if (status === "reserved") throw conflict(NOT_CHECKED_OUT);
  if (status === "pending-photo") throw conflict(WAITING_FOR_PHOTO);
  if (status !== "out") throw conflict(ALREADY_CHECKED_IN);
}

/** The check-in outcome, from a check-in or the finish of a pending-photo loan: parts not hung go missing,
 * the fee (if any) is recorded in Kill Bill, and a completed return frees its tools for holds. */
async function completeCheckin(
  client: pg.PoolClient,
  loan: { id: number; ref: string; member_id: number; fee_rules: FeeRules; item_ids: number[] },
  openDays: number,
  calendar: Calendar,
  now: number,
): Promise<number | null> {
  await client.query(
    `UPDATE parts SET state = 'missing' WHERE state = 'out' AND item_id IN (SELECT item_id FROM loan_items WHERE loan_id = $1)`,
    [loan.id],
  );
  const status = await returnStatus(client, loan.item_ids);
  const items = await rows<{ id: number; name: string; tag: string; grade: Grade }>(
    client,
    `SELECT i.id, i.name, i.tag, li.grade FROM loan_items li JOIN items i ON i.id = li.item_id WHERE li.loan_id = $1 ORDER BY li.position`,
    [loan.id],
  );
  const lines = feeLines(loan.fee_rules, items, openDays);
  const lateTotal = lateFeeSoFar(loan.fee_rules, loan.item_ids, openDays);
  await client.query(`UPDATE loans SET status = $2, recorded_open_days_late = $3, recorded_late_fee_cents = $4 WHERE id = $1`, [
    loan.id,
    status,
    openDays,
    lateTotal,
  ]);
  let feeId: number | null = null;
  if (lines.length > 0) {
    const total = lines.reduce((sum, l) => sum + l.amount_cents, 0);
    const [member] = await rows<{ email: string; killbill_account_id: string }>(
      client,
      `SELECT u.email, m.killbill_account_id FROM users u JOIN memberships m ON m.user_id = u.id WHERE u.id = $1`,
      [loan.member_id],
    );
    const invoice = await withBilling(CHECKIN_BILLING_DOWN, () => raiseCharges(member!.killbill_account_id, lines));
    const [fee] = await rows<{ id: number }>(
      client,
      `INSERT INTO fees (loan_id, member_id, status, total_cents, killbill_invoice_id, killbill_invoice_number)
       VALUES ($1, $2, 'raised', $3, $4, $5) RETURNING id`,
      [loan.id, loan.member_id, total, invoice.invoiceId, invoice.invoiceNumber],
    );
    feeId = fee!.id;
    for (const [position, line] of lines.entries()) {
      await client.query(
        `INSERT INTO fee_lines (fee_id, position, item_id, kind, open_days, amount_cents, description) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [feeId, position, line.item_id, line.kind, line.open_days, line.amount_cents, line.description],
      );
    }
    await queueMail(
      client,
      member!.email,
      `Pegworth fees for loan ${loan.ref}: $${dollars(total)}`,
      [
        `Fees for loan ${loan.ref}`,
        "",
        ...lines.map((l) => `${l.description}: $${dollars(l.amount_cents)}`),
        "",
        `Total: $${dollars(total)}`,
        `Kill Bill invoice number: ${invoice.invoiceNumber}`,
        "",
        `See and pay this fee: ${config.publicUrl}/fees/${feeId}`,
        "",
        "Pegworth Desk",
      ].join("\n"),
    );
  }
  if (status === "returned-complete") for (const itemId of loan.item_ids) await promoteIfFree(client, itemId, calendar, now);
  return feeId;
}

/** Runs a photo-writing transition; the object it stored is deleted again if the transaction does not commit. */
async function withPhotoCleanup<T>(work: (stored: StoredPhoto[]) => Promise<T>): Promise<T> {
  const stored: StoredPhoto[] = [];
  try {
    return await work(stored);
  } catch (error) {
    for (const photo of stored) await deletePhotoObject(photo.key).catch(() => undefined);
    throw error;
  }
}

function gradesFrom(ctx: Ctx, itemIds: readonly number[]): Record<string, Grade> | null {
  try {
    const value: unknown = JSON.parse(ctx.multipart!.fields.grades ?? "");
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    const grades = value as Record<string, unknown>;
    const allowed = new Set(["good", "worn", "damaged"]);
    const covered = itemIds.every((id) => typeof grades[String(id)] === "string" && allowed.has(grades[String(id)] as string));
    return covered && Object.keys(grades).length === itemIds.length ? (grades as Record<string, Grade>) : null;
  } catch {
    return null;
  }
}

async function finishedReply(loanId: number, feeId: number | null, status: number, calendar: Calendar, now: number): Promise<Reply> {
  kickMail();
  const fee = feeId === null ? null : (await loadFees(pool, { ids: [feeId] }, calendar))[0]!;
  return { status, body: { loan: await loanView(pool, loanId, calendar, now), fee } };
}

export const loanRoutes = [
  route({
    method: "GET",
    path: "/api/loans",
    access: "signed-in",
    body: "none",
    find: async (ctx) => {
      const asked = ctx.query.get("member_id");
      const memberId = asked === null ? null : idFrom(asked);
      if (ctx.caller!.role === "member" && memberId !== null && memberId !== ctx.caller!.id) throw notFound();
      return memberId;
    },
    handle: async (ctx, memberId): Promise<Reply> => {
      const calendar = await loadCalendar(pool);
      const statuses = ctx.query.get("status")?.split(",").filter(Boolean);
      const filter = ctx.caller!.role === "member" ? { memberId: ctx.caller!.id } : { memberId: memberId ?? undefined, statuses };
      return { status: 200, body: { loans: await loadLoans(pool, filter, calendar, ctx.now) } };
    },
  }),
  route({
    method: "GET",
    path: "/api/loans/:id",
    access: "signed-in",
    body: "none",
    find: findLoan,
    handle: async (ctx, loan): Promise<Reply> => {
      const calendar = await loadCalendar(pool);
      return { status: 200, body: { loan: await loanView(pool, loan.id, calendar, ctx.now) } };
    },
  }),
  route({
    method: "POST",
    path: "/api/loans",
    access: "signed-in",
    roles: STAFF,
    body: "json",
    find: async (ctx) => {
      const memberId = idFrom(ctx.json?.member_id);
      if (memberId !== null && !(await one(pool, `SELECT 1 FROM users WHERE id = $1 AND role = 'member'`, [memberId]))) throw notFound();
      const itemIds = Array.isArray(ctx.json?.item_ids) ? (ctx.json!.item_ids as unknown[]).map(idFrom).filter((id): id is number => id !== null) : [];
      const known = await rows<{ id: number }>(pool, `SELECT id FROM items WHERE id = ANY($1)`, [itemIds]);
      if (known.length !== new Set(itemIds).size) throw notFound();
      return undefined;
    },
    forbid: (ctx) => (ctx.caller!.role !== "coordinator" && ctx.json !== null && "checked_out_at" in ctx.json ? "Only the coordinator can do that." : null),
    validate: (ctx) => {
      const body = ctx.json ?? {};
      const fields: Fields = {};
      if (idFrom(body.member_id) === null || typeof body.member_id !== "number") fields.member_id = "Choose a member.";
      const ids: unknown[] | null = Array.isArray(body.item_ids) ? (body.item_ids as unknown[]) : null;
      if (
        ids === null ||
        ids.length === 0 ||
        ids.length > 10 ||
        !ids.every((id) => typeof id === "number" && idFrom(id) !== null) ||
        new Set(ids).size !== ids.length
      ) {
        fields.item_ids = "Add 1 to 10 different tools.";
      }
      if ("checked_out_at" in body) {
        const at = parseInstant(body.checked_out_at);
        if (at === null || at > ctx.now || at < ctx.now - 120 * DAY) fields.checked_out_at = "Give a time in the last 120 days, as ISO 8601 with an offset.";
      }
      return fields;
    },
    handle: async (ctx): Promise<Reply> => {
      const body = ctx.json!;
      const memberId = body.member_id as number;
      const itemIds = body.item_ids as number[];
      const calendar = await loadCalendar(pool);
      const loanId = await transaction(async (client) => {
        await client.query(`SELECT id FROM items WHERE id = ANY($1) ORDER BY id FOR UPDATE`, [itemIds]);
        const membership = await membershipOf(client, memberId);
        if (membershipStatus(membership!, today(calendar, ctx.now)) !== "active") throw conflict("This member's membership is not active.");
        const items = await loadItems(client, itemIds);
        const readyHolders = await rows<{ item_id: number; member_id: number }>(
          client,
          `SELECT item_id, member_id FROM holds WHERE item_id = ANY($1) AND status = 'ready'`,
          [itemIds],
        );
        for (const id of itemIds) {
          const item = items.find((i) => i.id === id)!;
          if (item.status === "out" || item.status === "reserved" || item.status === "pending-photo") throw conflict(`${item.tag} is not on the wall.`);
          if (item.status === "incomplete") throw conflict(`${item.tag} is missing parts.`);
          if (item.status === "held" && !readyHolders.some((h) => h.item_id === id && h.member_id === memberId)) {
            throw conflict(`${item.tag} is held for another member.`);
          }
        }
        const requested = "checked_out_at" in body ? new Date(parseInstant(body.checked_out_at)!) : null;
        const [loan] = await rows<{ id: number }>(
          client,
          `INSERT INTO loans (ref, member_id, status, requested_checked_out_at)
           VALUES ('L-' || lpad(nextval('loan_ref_seq')::text, 4, '0'), $1, 'reserved', $2) RETURNING id`,
          [memberId, requested],
        );
        for (const [position, id] of itemIds.entries()) {
          await client.query(`INSERT INTO loan_items (loan_id, item_id, position) VALUES ($1, $2, $3)`, [loan!.id, id, position]);
        }
        return loan!.id;
      });
      return { status: 201, body: { loan: await loanView(pool, loanId, calendar, ctx.now) } };
    },
  }),
  route({
    method: "DELETE",
    path: "/api/loans/:id",
    access: "signed-in",
    roles: STAFF,
    body: "none",
    find: findLoan,
    handle: async (ctx, found): Promise<Reply> => {
      const calendar = await loadCalendar(pool);
      await transaction(async (client) => {
        const loan = await lockLoan(client, found.id);
        if (loan.status !== "reserved") throw conflict("Only a reserved loan can be cancelled.");
        await client.query(`SELECT id FROM items WHERE id = ANY($1) ORDER BY id FOR UPDATE`, [loan.item_ids]);
        await client.query(`DELETE FROM loans WHERE id = $1`, [loan.id]);
        for (const itemId of loan.item_ids) await promoteIfFree(client, itemId, calendar, ctx.now);
      });
      kickMail();
      return { status: 204 };
    },
  }),
  route({
    method: "POST",
    path: "/api/loans/:id/checkout",
    access: "signed-in",
    roles: STAFF,
    body: "multipart",
    find: findLoan,
    validate: (ctx) => collect({}, [["photo", photoProblem(ctx)], ["captured_at", capturedProblem(ctx)]]),
    handle: async (ctx, found): Promise<Reply> => {
      const calendar = await loadCalendar(pool);
      await withPhotoCleanup((stored) =>
        transaction(async (client) => {
          const loan = await lockLoan(client, found.id);
          if (loan.status !== "reserved") throw conflict("This loan is already checked out.");
          const items = await rows<{ id: number; replacement_cost_cents: number }>(
            client,
            `SELECT id, replacement_cost_cents FROM items WHERE id = ANY($1) ORDER BY id FOR UPDATE`,
            [loan.item_ids],
          );
          try {
            stored.push(await storePhoto(client, loan, "checkout", ctx));
          } catch (error) {
            if (error instanceof ProviderDown) throw new ApiError(503, "Photo storage is down. The loan stays reserved; check it out when storage is back.");
            throw error;
          }
          const settings = await loadSettings(client);
          const checkedOutAt = loan.requested_checked_out_at?.getTime() ?? ctx.now;
          await client.query(`UPDATE loans SET status = 'out', checked_out_at = $2, due_date = $3, fee_rules = $4 WHERE id = $1`, [
            loan.id,
            new Date(checkedOutAt),
            dueDateFor(calendar, checkedOutAt, settings.loan_period_days),
            recordFeeRules(settings, items),
          ]);
          await client.query(`UPDATE parts SET state = 'out' WHERE item_id = ANY($1)`, [loan.item_ids]);
          await client.query(`UPDATE holds SET status = 'collected' WHERE item_id = ANY($1) AND member_id = $2 AND status = 'ready'`, [
            loan.item_ids,
            loan.member_id,
          ]);
        }),
      );
      return { status: 200, body: { loan: await loanView(pool, found.id, calendar, ctx.now) } };
    },
  }),
  route({
    method: "POST",
    path: "/api/loans/:id/hang",
    access: "signed-in",
    roles: STAFF,
    body: "json",
    find: async (ctx) => {
      const loan = await findLoan(ctx);
      const partId = idFrom(ctx.json?.part_id);
      const pegId = idFrom(ctx.json?.peg_part_id);
      if (partId !== null && !(await one(pool, `SELECT 1 FROM parts WHERE id = $1 AND item_id = ANY($2)`, [partId, loan.item_ids]))) throw notFound();
      if (pegId !== null && !(await one(pool, `SELECT 1 FROM parts WHERE id = $1`, [pegId]))) throw notFound();
      return loan;
    },
    validate: (ctx) => {
      const partId = idFrom(ctx.json?.part_id);
      const pegId = idFrom(ctx.json?.peg_part_id);
      const fields: Fields = {};
      if (partId === null) fields.part_id = "Choose a tag card.";
      if (pegId === null) fields.peg_part_id = "Choose an outline.";
      if (partId !== null && pegId !== null && partId !== pegId) throw invalid({ peg_part_id: WRONG_PEG }, WRONG_PEG);
      return fields;
    },
    handle: async (ctx, found): Promise<Reply> => {
      const partId = idFrom(ctx.json!.part_id)!;
      const calendar = await loadCalendar(pool);
      const body = await transaction(async (client) => {
        const loan = await lockLoan(client, found.id);
        const [part] = await rows<{ name: string; state: string }>(client, `SELECT name, state FROM parts WHERE id = $1 FOR UPDATE`, [partId]);
        if (loan.status === "reserved") throw conflict(NOT_CHECKED_OUT);
        if (loan.status === "pending-photo") throw conflict(WAITING_FOR_PHOTO);
        if (part!.state === "hung") throw conflict(`${part!.name} is already on its peg.`);
        if (loan.status === "returned-complete") throw conflict(ALREADY_CHECKED_IN);
        await client.query(`UPDATE parts SET state = 'hung' WHERE id = $1`, [partId]);
        if (loan.status === "returned-partial") {
          if ((await returnStatus(client, loan.item_ids)) === "returned-complete") {
            await client.query(`UPDATE loans SET status = 'returned-complete' WHERE id = $1`, [loan.id]);
            for (const itemId of loan.item_ids) await promoteIfFree(client, itemId, calendar, ctx.now);
          }
        }
        return { loan: await loanView(client, loan.id, calendar, ctx.now), counts: await loadCounts(client) };
      });
      kickMail();
      return { status: 200, body };
    },
  }),
  route({
    method: "DELETE",
    path: "/api/loans/:id/hang/:part_id",
    access: "signed-in",
    roles: STAFF,
    body: "none",
    find: async (ctx) => {
      const loan = await findLoan(ctx);
      const partId = pathId(ctx.params.part_id);
      if (partId === null || !(await one(pool, `SELECT 1 FROM parts WHERE id = $1 AND item_id = ANY($2)`, [partId, loan.item_ids]))) throw notFound();
      return { loan, partId };
    },
    handle: async (ctx, { loan: found, partId }): Promise<Reply> => {
      const calendar = await loadCalendar(pool);
      const body = await transaction(async (client) => {
        const loan = await lockLoan(client, found.id);
        requireOut(loan.status);
        await client.query(`UPDATE parts SET state = 'out' WHERE id = $1 AND state = 'hung'`, [partId]);
        return { loan: await loanView(client, loan.id, calendar, ctx.now), counts: await loadCounts(client) };
      });
      return { status: 200, body };
    },
  }),
  route({
    method: "POST",
    path: "/api/loans/:id/checkin",
    access: "signed-in",
    roles: STAFF,
    body: "multipart",
    find: findLoan,
    validate: (ctx, loan) => {
      const fields: Fields = {};
      if (!gradesFrom(ctx, loan.item_ids)) fields.grades = "Grade every tool on the loan.";
      const returnedText = ctx.multipart!.fields.returned_at;
      if (returnedText !== undefined && returnedText.trim() !== "") {
        const returned = parseInstant(returnedText);
        if (returned === null || returned > ctx.now || (loan.checked_out_at !== null && returned < loan.checked_out_at.getTime())) {
          fields.returned_at = "Give a return time between the checkout and now.";
        }
      }
      return collect(fields, [["captured_at", capturedProblem(ctx)], ["photo", photoProblem(ctx)]]);
    },
    handle: async (ctx, found): Promise<Reply> => {
      const calendar = await loadCalendar(pool);
      const grades = gradesFrom(ctx, found.item_ids)!;
      const returnedText = ctx.multipart!.fields.returned_at?.trim();
      const returnedAt = returnedText ? parseInstant(returnedText)! : ctx.now;
      const outcome = await withPhotoCleanup((stored) =>
        transaction(async (client) => {
          const loan = await lockLoan(client, found.id);
          requireOut(loan.status);
          for (const [itemId, grade] of Object.entries(grades)) {
            await client.query(`UPDATE loan_items SET grade = $3 WHERE loan_id = $1 AND item_id = $2`, [loan.id, Number(itemId), grade]);
          }
          const openDays = openDaysLate(calendar, loan.due_date, returnedAt);
          await client.query(`UPDATE loans SET returned_at = $2 WHERE id = $1`, [loan.id, new Date(returnedAt)]);
          try {
            stored.push(await storePhoto(client, loan, "checkin", ctx));
          } catch (error) {
            if (!(error instanceof ProviderDown)) throw error;
            await client.query(
              `UPDATE loans SET status = 'pending-photo', recorded_open_days_late = $2, recorded_late_fee_cents = $3 WHERE id = $1`,
              [loan.id, openDays, lateFeeSoFar(loan.fee_rules, loan.item_ids, openDays)],
            );
            return { status: 202, feeId: null };
          }
          return { status: 200, feeId: await completeCheckin(client, loan, openDays, calendar, ctx.now) };
        }),
      );
      return finishedReply(found.id, outcome.feeId, outcome.status, calendar, ctx.now);
    },
  }),
  route({
    method: "POST",
    path: "/api/loans/:id/finish",
    access: "signed-in",
    roles: STAFF,
    body: "multipart",
    find: findLoan,
    validate: (ctx) => collect({}, [["captured_at", capturedProblem(ctx)], ["photo", photoProblem(ctx)]]),
    handle: async (ctx, found): Promise<Reply> => {
      const calendar = await loadCalendar(pool);
      const feeId = await withPhotoCleanup((stored) =>
        transaction(async (client) => {
          const loan = await lockLoan(client, found.id);
          if (loan.status !== "pending-photo") throw conflict("This loan is not waiting for a photo.");
          try {
            stored.push(await storePhoto(client, loan, "checkin", ctx));
          } catch (error) {
            if (error instanceof ProviderDown) {
              throw new ApiError(503, "Photo storage is down. This check-in is still pending photo; finish it when storage is back.");
            }
            throw error;
          }
          return completeCheckin(client, loan, loan.recorded_open_days_late!, calendar, ctx.now);
        }),
      );
      return finishedReply(found.id, feeId, 200, calendar, ctx.now);
    },
  }),
];

