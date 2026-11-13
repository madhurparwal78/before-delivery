// Holds: the single-winner claim, the deposit, cancel with refund, expiry at the action, and the
// all-or-nothing purchase. Holds and purchases replay under their Idempotency-Key.
import { createHash } from "node:crypto";
import type pg from "pg";
import type { User } from "../../shared/api";
import {
  DEPOSIT_CENTS, fitLayout, invoiceLines, KERF_ALLOWANCE_MM, lengthText, money, validCardNumber, volumeMm3, zonesWithin,
} from "../../shared/domain";
import { ensureAccount, PaymentFailed, purchase as chargeKillBill, refund } from "../billing";
import { config } from "../config";
import { one, pool, query, withClient, withTransaction, yardId } from "../db";
import { ApiError, Fields, isObject, ok, requireRole, requireUser, route, type Context, type Reply } from "../http";
import { renderPdf, type TicketLine } from "../pdf";
import { Unreachable } from "../services";
import { deleteQuietly, putObject } from "../storage";
import {
  boardFigures, boardRow, expireIfDue, HOLD_SELECT, holdJson, lockLineage, nextId, nextTag, notFound, now, orderedPieces,
  ratesInForce, writeMovement, type HoldRow,
} from "../store";
import { readPieces } from "./boards";

const DECLINED_CARD = "4000000000000002";
const KEY_FORMAT = /^[A-Za-z0-9_-]{1,64}$/;
const STORED_STATUSES = new Set([201, 402, 409, 422]);
const IDEMPOTENCY_LOCK = 7_331_003;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * Step 3 of the precedence. With a well-formed key, requests are serialised per maker and key: a
 * stored response for the same method, path and body is replayed, a different request conflicts.
 */
async function idempotent(ctx: Context, user: User, run: (keyValid: boolean) => Promise<Reply>): Promise<Reply> {
  const header = ctx.req.headers["idempotency-key"];
  const key = typeof header === "string" && KEY_FORMAT.test(header) ? header : null;
  if (key === null) return run(false);
  const fingerprint = createHash("sha256").update(`${ctx.req.method}\n${ctx.url.pathname}\n${canonicalJson(ctx.body)}`).digest("hex");
  return withClient(async (client) => {
    await client.query("SELECT pg_advisory_lock($1, hashtext($2))", [IDEMPOTENCY_LOCK, `${user.id}:${key}`]);
    try {
      const stored = await one<{ fingerprint: string; status: number; body: string }>(client,
        "SELECT fingerprint, status, body FROM idempotency WHERE maker_id = $1 AND key = $2", [user.id, key]);
      if (stored !== undefined) {
        if (stored.fingerprint !== fingerprint) throw new ApiError("idempotency_conflict");
        return { status: stored.status, raw: { bytes: Buffer.from(stored.body), contentType: "application/json; charset=utf-8" } };
      }
      let reply: Reply;
      try {
        reply = await run(true);
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        reply = { status: error.status, body: error.body() };
      }
      if (STORED_STATUSES.has(reply.status)) {
        await client.query(
          "INSERT INTO idempotency (maker_id, key, fingerprint, status, body, created_at) VALUES ($1, $2, $3, $4, $5, now())",
          [user.id, key, fingerprint, reply.status, JSON.stringify(reply.body)]);
      }
      return reply;
    } finally {
      await client.query("SELECT pg_advisory_unlock($1, hashtext($2))", [IDEMPOTENCY_LOCK, `${user.id}:${key}`]);
    }
  });
}

async function releaseClaim(holdId: string): Promise<void> {
  await pool.query("UPDATE holds SET status = 'released', release_reason = 'payment-failed' WHERE id = $1 AND status = 'pending-payment'", [holdId]);
}

route("POST", "/api/holds", async (ctx) => {
  const user = requireUser(ctx);
  return idempotent(ctx, user, async (keyValid) => {
    const b = isObject(ctx.body) ? ctx.body : {};
    const tag = typeof b["board"] === "string" ? b["board"] : null;
    if (tag !== null) {
      const row = await boardRow(pool, tag);
      if (row === undefined || (row.status !== "available" && row.status !== "held")) notFound();
    }
    requireRole(user, "maker");
    const fields = new Fields();
    if (tag === null) fields.add("board", "Give the board tag.");
    const pieces = readPieces(b["pieces"], fields);
    const card = typeof b["card_number"] === "string" ? b["card_number"] : "";
    if (!validCardNumber(card)) fields.add("card_number", "Enter a valid card number.");
    if (!keyValid) fields.add("idempotency_key", "Send an Idempotency-Key of 1 to 64 letters, digits, - or _.");
    if (tag === null) fields.throwIfAny();
    const claimed = await withTransaction(async (db) => {
      await lockLineage(db, tag ?? "");
      const board = await boardRow(db, tag ?? "", true);
      if (board === undefined) notFound();
      const at = now();
      const live = await query<HoldRow>(db, `${HOLD_SELECT} WHERE h.board_tag = $1 AND h.status IN ('pending-payment','held') FOR UPDATE OF h`, [board.tag]);
      for (const h of live) await expireIfDue(db, h, at);
      if (live.some((h) => h.status === "pending-payment" || h.status === "held")) return "already_held" as const;
      const current = await boardRow(db, board.tag);
      if (current?.status !== "available") return "board_state" as const;
      const { table } = await ratesInForce(db, at);
      const fit = fitLayout(current, pieces, boardFigures(current, table).rate_cents);
      if (pieces.length > 0 && (fit.pieces.some((p) => p.status !== "clear") || fit.price_cents === null || fit.price_cents <= DEPOSIT_CENTS
        || fit.take_mm === null || fit.sale === null)) {
        fields.add("pieces", "Every piece must fit clear of defects and the price must be above the deposit.");
      }
      fields.throwIfAny();
      const id = await nextId(db, "hold_seq", "H");
      await db.query(
        `INSERT INTO holds (id, board_tag, maker_id, status, release_reason, pieces, cuts_mm, take_mm, sale, offcut_mm, price_cents,
           deposit_cents, created_at) VALUES ($1, $2, $3, 'pending-payment', NULL, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [id, board.tag, user.id, JSON.stringify(orderedPieces(pieces)), JSON.stringify(fit.cuts_mm), fit.take_mm, fit.sale,
          fit.offcut_mm, fit.price_cents, DEPOSIT_CENTS, at]);
      return id;
    });
    if (claimed === "already_held" || claimed === "board_state") throw new ApiError(claimed);
    if (card.replace(/ /g, "") === DECLINED_CARD) {
      await releaseClaim(claimed);
      throw new ApiError("card_declined");
    }
    let payment;
    try {
      const account = await ensureAccount(user.id, user.name, user.email);
      payment = await chargeKillBill(account, DEPOSIT_CENTS, `hold-${await yardId()}-${claimed}`);
    } catch (error) {
      await releaseClaim(claimed);
      if (error instanceof Unreachable) throw new ApiError("billing_unavailable");
      if (error instanceof PaymentFailed) throw new ApiError("payment_failed");
      throw error;
    }
    if (!payment.success || payment.paymentId === null) {
      await releaseClaim(claimed);
      throw new ApiError("payment_failed");
    }
    const paymentId = payment.paymentId;
    const hold = await withTransaction(async (db) => {
      const heldAt = now();
      const expires = new Date(heldAt.getTime() + config.holdSeconds * 1000);
      await db.query("UPDATE holds SET status = 'held', held_at = $2, expires_at = $3, killbill_payment_id = $4 WHERE id = $1",
        [claimed, heldAt, expires, paymentId]);
      await db.query("UPDATE boards SET status = 'held' WHERE tag = $1", [tag]);
      return one<HoldRow>(db, `${HOLD_SELECT} WHERE h.id = $1`, [claimed]);
    });
    if (hold === undefined) notFound();
    return ok({ hold: holdJson(hold, false) }, 201);
  });
});

/** Holds load for their maker and the owner; another maker gets not_found, the hand forbidden. */
async function readableHold(ctx: Context, user: User, id: string): Promise<HoldRow> {
  const hold = await one<HoldRow>(pool, `${HOLD_SELECT} WHERE h.id = $1`, [id]);
  if (hold === undefined || (user.role === "maker" && hold.maker_id !== user.id)) notFound();
  return hold;
}

route("GET", "/api/holds", async (ctx) => {
  const user = requireUser(ctx);
  requireRole(user, "maker", "owner");
  const rows = user.role === "owner"
    ? await query<HoldRow>(pool, `${HOLD_SELECT} ORDER BY h.created_at DESC, h.id DESC`)
    : await query<HoldRow>(pool, `${HOLD_SELECT} WHERE h.maker_id = $1 ORDER BY h.created_at DESC, h.id DESC`, [user.id]);
  return ok({ holds: rows.map((h) => holdJson(h, user.role === "owner")) });
});

route("GET", "/api/holds/:id", async (ctx) => {
  const user = requireUser(ctx);
  const hold = await readableHold(ctx, user, ctx.params["id"] ?? "");
  requireRole(user, "maker", "owner");
  return ok({ hold: holdJson(hold, user.role === "owner") });
});

/** Locks a hold and decides expiry in the same step; an expired release is committed before refusing. */
async function lockActiveHold(db: pg.PoolClient, holdId: string): Promise<HoldRow | "not_active"> {
  const peek = await one<{ board_tag: string }>(db, "SELECT board_tag FROM holds WHERE id = $1", [holdId]);
  await lockLineage(db, peek?.board_tag ?? "");
  const hold = await one<HoldRow>(db, `${HOLD_SELECT} WHERE h.id = $1 FOR UPDATE OF h`, [holdId]);
  if (hold === undefined) notFound();
  if (await expireIfDue(db, hold, now())) return "not_active";
  return hold.status === "held" ? hold : "not_active";
}

route("POST", "/api/holds/:id/cancel", async (ctx) => {
  const user = requireUser(ctx);
  const id = ctx.params["id"] ?? "";
  await readableHold(ctx, user, id);
  requireRole(user, "maker");
  const result = await withTransaction(async (db) => {
    const hold = await lockActiveHold(db, id);
    if (hold === "not_active") return hold;
    let refunded: boolean;
    try {
      refunded = await refund(hold.killbill_payment_id ?? "", hold.deposit_cents);
    } catch (error) {
      if (error instanceof Unreachable) throw new ApiError("billing_unavailable");
      throw error;
    }
    if (!refunded) throw new ApiError("payment_failed");
    await db.query("UPDATE holds SET status = 'released', release_reason = 'cancelled' WHERE id = $1", [id]);
    await db.query("UPDATE boards SET status = 'available' WHERE tag = $1 AND status = 'held'", [hold.board_tag]);
    return one<HoldRow>(db, `${HOLD_SELECT} WHERE h.id = $1`, [id]);
  });
  if (result === "not_active" || result === undefined) throw new ApiError("hold_not_active");
  return ok({ hold: holdJson(result, false) });
});

function ticketPdf(ticket: string, board: string, maker: string, hold: HoldRow, lines: number[]): Buffer {
  const out: TicketLine[] = [
    { text: `Kerfwell cut ticket ${ticket}`, size: 18, bold: true },
    { text: `Ticket ${ticket}`, gap: 8 },
    { text: `Board ${board}` },
    { text: `Maker ${maker}` },
    { text: "Pieces", bold: true, gap: 10 },
    ...hold.pieces.map((p) => ({ text: `${p.label}: ${lengthText(p.length_mm, "mm")} at ${lengthText(p.start_mm, "mm")}` })),
    { text: "Cuts", bold: true, gap: 10 },
  ];
  const cuts = hold.cuts_mm.map((c) => lengthText(c, "mm"));
  for (let i = 0; i < cuts.length; i += 8) out.push({ text: cuts.slice(i, i + 8).join(", ") });
  if (cuts.length === 0) out.push({ text: "No cuts" });
  out.push(
    { text: `Take ${lengthText(hold.take_mm, "mm")}`, gap: 10 },
    { text: `Planned offcut ${hold.offcut_mm === null ? "none" : lengthText(hold.offcut_mm, "mm")}` },
    { text: "Invoice lines", bold: true, gap: 10 },
    ...hold.pieces.map((p, i) => ({ text: `${p.label} $${money(lines[i] ?? 0)}` })),
  );
  return renderPdf(out);
}

route("POST", "/api/holds/:id/purchase", async (ctx) => {
  const user = requireUser(ctx);
  return idempotent(ctx, user, async (keyValid) => {
    const id = ctx.params["id"] ?? "";
    await readableHold(ctx, user, id);
    requireRole(user, "maker");
    const client = await pool.connect();
    let pdfKey: string | null = null;
    let salePayment: string | null = null;
    try {
      await client.query("BEGIN");
      const hold = await lockActiveHold(client, id);
      if (hold === "not_active") {
        await client.query("COMMIT");
        throw new ApiError("hold_not_active");
      }
      if (!keyValid) throw new ApiError("validation", { idempotency_key: "Send an Idempotency-Key of 1 to 64 letters, digits, - or _." });
      const board = await boardRow(client, hold.board_tag, true);
      if (board === undefined) notFound();
      const ticket = await nextId(client, "ticket_seq", "CT");
      const lines = invoiceLines(hold.price_cents, hold.pieces.map((p) => p.length_mm));
      const amount = hold.price_cents - hold.deposit_cents;
      const key = `tickets/${ticket}.pdf`;
      try {
        await putObject(key, ticketPdf(ticket, board.tag, user.name, hold, lines), "application/pdf");
      } catch (error) {
        if (error instanceof Unreachable) throw new ApiError("storage_unavailable");
        throw error;
      }
      pdfKey = key;
      let payment;
      try {
        const account = await ensureAccount(user.id, user.name, user.email);
        payment = await chargeKillBill(account, amount, `sale-${await yardId()}-${ticket}`);
      } catch (error) {
        if (error instanceof Unreachable) throw new ApiError("billing_unavailable");
        if (error instanceof PaymentFailed) throw new ApiError("payment_failed");
        throw error;
      }
      if (!payment.success || payment.paymentId === null) throw new ApiError("payment_failed");
      salePayment = payment.paymentId;
      const at = now();
      const t = board.thickness_mm;
      const w = board.width_mm;
      const volume = volumeMm3(t, w, board.length_mm);
      let offcut: { tag: string; length_mm: number } | null = null;
      await client.query("UPDATE holds SET status = 'converted-to-sale' WHERE id = $1", [id]);
      await client.query("UPDATE boards SET status = $2 WHERE tag = $1", [board.tag, hold.sale === "cut" ? "cut" : "sold-whole"]);
      await client.query(
        `INSERT INTO tickets (id, board_tag, maker_id, hold_id, pieces, cuts_mm, take_mm, sale, offcut_tag, planned_mm, measured_mm, status,
           pdf_key, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, $9, NULL, 'issued', $10, $11)`,
        [ticket, board.tag, user.id, id, JSON.stringify(hold.pieces), JSON.stringify(hold.cuts_mm), hold.take_mm, hold.sale,
          hold.offcut_mm, key, at]);
      if (hold.sale === "cut" && hold.offcut_mm !== null) {
        const tag = await nextTag(client);
        const from = hold.take_mm + KERF_ALLOWANCE_MM;
        await client.query(
          `INSERT INTO boards (tag, species, grade, status, lot_id, length_mm, width_mm, thickness_mm, defects, parent_tag, cut_ticket, created_at)
           VALUES ($1, $2, $3, 'graded', $4, $5, $6, $7, $8, $9, $10, $11)`,
          [tag, board.species, board.grade, board.lot_id, hold.offcut_mm, w, t,
            JSON.stringify(zonesWithin(board.defects, from, hold.offcut_mm)), board.tag, ticket, at]);
        await client.query("UPDATE tickets SET offcut_tag = $2 WHERE id = $1", [ticket, tag]);
        offcut = { tag, length_mm: hold.offcut_mm };
        await writeMovement(client, "split", ticket, user.id, [
          { account: `board:${board.tag}`, volume_mm3: -volume },
          { account: `sold:${ticket}`, volume_mm3: volumeMm3(t, w, hold.take_mm) },
          { account: `board:${tag}`, volume_mm3: volumeMm3(t, w, hold.offcut_mm) },
          { account: "kerf", volume_mm3: volumeMm3(t, w, KERF_ALLOWANCE_MM) },
        ], at);
      } else {
        await writeMovement(client, "whole-sale", ticket, user.id, [
          { account: `board:${board.tag}`, volume_mm3: -volume }, { account: `sold:${ticket}`, volume_mm3: volume }], at);
      }
      await client.query("INSERT INTO ticket_events (ticket_id, kind, by_user, at) VALUES ($1, 'issued', $2, $3)", [ticket, user.id, at]);
      const invoice = await nextId(client, "invoice_seq", "INV");
      await client.query(
        `INSERT INTO invoices (id, ticket_id, board_tag, maker_id, price_cents, deposit_cents, amount_cents, lines, paid_at, killbill_payment_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [invoice, ticket, board.tag, user.id, hold.price_cents, hold.deposit_cents, amount,
          JSON.stringify(hold.pieces.map((p, i) => ({ label: p.label, length_mm: p.length_mm, amount_cents: lines[i] ?? 0 }))), at, salePayment]);
      await client.query("COMMIT");
      return ok({
        sale: {
          ticket, invoice, board: board.tag, sale: hold.sale, sold_mm: hold.take_mm, offcut, price_cents: hold.price_cents,
          deposit_cents: hold.deposit_cents, amount_cents: amount, killbill_payment_id: salePayment, pdf_url: `/api/tickets/${ticket}/pdf`,
        },
      }, 201);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (salePayment !== null) {
        const paid = salePayment;
        const hold = await one<HoldRow>(pool, `${HOLD_SELECT} WHERE h.id = $1`, [id]);
        await refund(paid, (hold?.price_cents ?? 0) - (hold?.deposit_cents ?? 0)).catch((e: unknown) => {
          console.error("refund after failed sale did not go through:", e instanceof Error ? e.message : String(e));
        });
      }
      if (pdfKey !== null) await deleteQuietly([pdfKey]);
      throw error;
    } finally {
      client.release();
    }
  });
});
