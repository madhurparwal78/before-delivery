// Checkout keeps all of its artifacts or none. One database transaction spans the external steps; when a
// step fails, what already happened outside (stored passes, a Kill Bill authorisation or invoice) is undone
// and the transaction rolls back, so the holds stay active and nothing remains.
import { priceOrder } from "../../shared/allocation.ts";
import { dayLabel } from "../../shared/brussels.ts";
import { config } from "../config.ts";
import { db, transaction } from "../db/index.ts";
import { ApiError, FieldErrors, notFound, ok, route, type SignedInCtx } from "../http.ts";
import * as killbill from "../services/killbill.ts";
import { objectKeys, putAll, removeAll } from "../services/storage.ts";
import { newId, newOrderRef, newPassCode } from "./ids.ts";
import { issueInvoice } from "./invoices.ts";
import { mails } from "./mails.ts";
import { moveLines, orderView, passDocument } from "./orders.ts";
import { queueMail } from "./outbox.ts";
import { edition, festivalDays } from "./programme.ts";
import { recordMovement, lockVoucher } from "./vouchers.ts";
import { asObject } from "./validate.ts";

const GROUP_MINIMUM = 5;
const PASS_LIMIT = { visitor: 10, group_booker: 30 } as const;

type PassRequest = { product: "full_festival" } | { product: "day"; festival_day: string };
type HoldForCheckout = {
  id: string; session_id: string; quantity: number; status: string; live: boolean; session_status: string; title: string;
  price_full_cents: number; price_reduced_cents: number;
};
type DraftLine = {
  id: string; position: number; kind: "seat" | "full_festival" | "day"; session_id: string | null; festival_day: string | null;
  title: string; holder_name: string; list_cents: number;
};

function readPasses(value: unknown): PassRequest[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  const out: PassRequest[] = [];
  for (const item of value) {
    if (item && typeof item === "object" && (item as { product?: unknown }).product === "full_festival") out.push({ product: "full_festival" });
    else if (item && typeof item === "object" && (item as { product?: unknown }).product === "day") {
      const day = (item as { festival_day?: unknown }).festival_day;
      out.push({ product: "day", festival_day: typeof day === "string" ? day : "" });
    } else return null;
  }
  return out;
}

/** Undoes an authorisation of a checkout that is not kept, and records both transactions for reconciliation. */
async function voidAuthorisation(auth: { paymentId: string; tx: killbill.KbTransaction }, ref: string): Promise<void> {
  const voided = await killbill.voidPayment(auth.paymentId, ref);
  await killbill.recordTransaction(db, auth.paymentId, auth.tx, { orderRef: ref });
  await killbill.recordTransaction(db, auth.paymentId, voided, { orderRef: ref });
}

async function checkout(ctx: SignedInCtx) {
  const user = ctx.user;
  const group = user.role === "group_booker";
  const body = asObject(ctx.body);
  const holdIds = body.hold_ids === undefined || body.hold_ids === null ? []
    : Array.isArray(body.hold_ids) && body.hold_ids.every((h) => typeof h === "string") ? [...new Set(body.hold_ids as string[])] : null;
  const passes = readPasses(body.passes);
  const now = new Date();
  const undo: (() => Promise<void>)[] = [];

  try {
    const orderId = await transaction(async (tx) => {
      // 404: every hold must exist and be the caller's.
      const holds = holdIds?.length ? await tx.all<HoldForCheckout>(
        `SELECT h.id, h.session_id, h.quantity, h.status, is_live(h.expires_at, $3) AS live,
           effective_status(s.status, s.publish_at, $3) AS session_status, s.title, s.price_full_cents, s.price_reduced_cents
         FROM holds h JOIN sessions s ON s.id = h.session_id WHERE h.id = ANY($1) AND h.user_id = $2 FOR UPDATE OF h`,
        [holdIds, user.id, now]) : [];
      if (holdIds && holds.length !== holdIds.length) throw notFound();
      const ordered = (holdIds ?? []).map((id) => holds.find((h) => h.id === id)!);

      // 409: lapsed holds, cancelled sessions.
      const lapsed = ordered.filter((h) => h.status !== "active" || !h.live).map((h) => h.id);
      if (lapsed.length) throw new ApiError(409, "hold_expired", { hold_ids: lapsed });
      if (ordered.some((h) => h.session_status === "cancelled")) throw new ApiError(409, "session_cancelled");

      // 422: what is being bought.
      const errors: Record<string, string> = {};
      const days = festivalDays(await edition(tx)).map((d) => d.date);
      const rate = body.rate === "reduced" ? "reduced" : body.rate === "full" || body.rate === undefined ? "full" : null;
      if (holdIds === null) errors.hold_ids = "invalid";
      if (passes === null) errors.passes = "invalid";
      else if (passes.some((p) => p.product === "day" && !days.includes(p.festival_day))) errors.passes = "unknown_festival_day";
      else if (passes.length > PASS_LIMIT[group ? "group_booker" : "visitor"]) errors.passes = "too_many";
      const seatCount = ordered.reduce((n, h) => n + h.quantity, 0);
      const lineCount = seatCount + (passes?.length ?? 0);
      if (lineCount === 0 && holdIds !== null && passes !== null) errors.items = "empty";
      else if (group && lineCount < GROUP_MINIMUM) errors.items = "group_minimum";
      if (rate === null) errors.rate = "invalid";
      else if (group && rate === "reduced") errors.rate = "not_for_groups";
      let names: string[] = [];
      if (group) {
        const given = body.attendee_names;
        if (!Array.isArray(given) || given.length !== lineCount) errors.attendee_names = "count_mismatch";
        else if (given.some((n) => typeof n !== "string" || !n.trim())) errors.attendee_names = "blank";
        else names = (given as string[]).map((n) => n.trim().slice(0, 200));
      }
      const code = typeof body.voucher_code === "string" && body.voucher_code.trim() ? body.voucher_code.trim().toUpperCase() : null;
      const voucher = code ? await lockVoucher(tx, code) : null;
      if (code && !voucher) errors.voucher_code = "unknown";
      else if (voucher && voucher.balance <= 0) errors.voucher_code = "empty";
      if (Object.keys(errors).length) throw new FieldErrors(errors);

      // Price at commit: seat lines first in hold order, then passes in request order.
      const policy = (await tx.one<{ full_festival_full_cents: number; full_festival_reduced_cents: number; day_full_cents: number; day_reduced_cents: number; group_discount_percent: number }>(
        "SELECT * FROM price_policy WHERE id = 1"))!;
      const reduced = rate === "reduced";
      const draft: DraftLine[] = [];
      for (const h of ordered) {
        for (let i = 0; i < h.quantity; i++) {
          draft.push({ id: newId(), position: draft.length + 1, kind: "seat", session_id: h.session_id, festival_day: null, title: h.title,
            holder_name: "", list_cents: reduced ? h.price_reduced_cents : h.price_full_cents });
        }
      }
      for (const p of passes!) {
        draft.push(p.product === "full_festival"
          ? { id: newId(), position: draft.length + 1, kind: "full_festival", session_id: null, festival_day: null, title: "Full-festival pass",
              holder_name: "", list_cents: reduced ? policy.full_festival_reduced_cents : policy.full_festival_full_cents }
          : { id: newId(), position: draft.length + 1, kind: "day", session_id: null, festival_day: p.festival_day, title: `Day pass — ${dayLabel(p.festival_day)}`,
              holder_name: "", list_cents: reduced ? policy.day_reduced_cents : policy.day_full_cents });
      }
      draft.forEach((l, i) => { l.holder_name = group ? names[i]! : user.name; });
      const priced = priceOrder(draft.map((l) => l.list_cents), group ? policy.group_discount_percent : null, voucher?.balance ?? 0);

      const id = newId();
      const ref = newOrderRef();
      const deadline = reduced ? new Date(now.getTime() + config.time.proofDecisionSeconds * 1000) : null;
      await tx.query("INSERT INTO orders (id, ref, buyer_id, organisation_id, rate, voucher_code, proof_deadline, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        [id, ref, user.id, group ? user.organisation_id : null, rate, voucher && priced.voucher_cents > 0 ? voucher.code : null, deadline, now]);
      for (const [i, l] of draft.entries()) {
        const p = priced.lines[i]!;
        await tx.query(`INSERT INTO lines (id, order_id, position, kind, session_id, festival_day, title, holder_name, state, list_cents,
          group_discount_cents, voucher_cents, charged_cents) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'authorised',$9,$10,$11,$12)`,
          [l.id, id, l.position, l.kind, l.session_id, l.festival_day, l.title, l.holder_name, p.list_cents, p.group_discount_cents, p.voucher_cents, p.charged_cents]);
      }
      await tx.query("UPDATE holds SET status = 'converted' WHERE id = ANY($1)", [holdIds ?? []]);
      if (voucher && priced.voucher_cents > 0) await recordMovement(tx, "redeem", voucher.code, priced.voucher_cents, user.email, ref);

      const mailLines = draft.map((l, i) => ({ ...l, ...priced.lines[i]! }));
      const lineIds = draft.map((l) => l.id);
      if (reduced) {
        // Reduced rate: authorise only; passes are stored at approval.
        if (priced.total_cents > 0) {
          const account = await killbill.accountFor(`kerf-user-${user.id}`, user.name, user.email);
          const auth = await killbill.authorize(account, ref, priced.total_cents);
          undo.push(() => voidAuthorisation(auth, ref));
          await tx.query("UPDATE orders SET kb_payment_id = $2 WHERE id = $1", [id, auth.paymentId]);
          await killbill.recordTransaction(tx, auth.paymentId, auth.tx, { orderRef: ref });
        }
        await moveLines(tx, lineIds, "proof_pending");
        const mailId = await queueMail(tx, mails.orderReceivedReduced(user.email, ref, id, mailLines, deadline!));
        await tx.query("UPDATE orders SET confirmation_outbox_id = $2 WHERE id = $1", [id, mailId]);
        return id;
      }

      // Full rate and group: store every pass first, then take the money or issue the invoice.
      const codes = draft.map(() => newPassCode());
      const documents = await Promise.all(draft.map((l, i) => passDocument(tx, l, codes[i]!)));
      const objects = draft.map((_, i) => ({ key: objectKeys.pass(ref, codes[i]!), body: documents[i]!, contentType: "application/pdf" }));
      await putAll(objects);
      undo.push(() => removeAll(objects.map((o) => o.key)));
      for (const [i, l] of draft.entries()) {
        await tx.query("INSERT INTO passes (code, line_id, status, created_at) VALUES ($1, $2, 'valid', $3)", [codes[i]!, l.id, now]);
      }
      if (group) {
        await issueInvoice(tx, { orderId: id, ref, booker: user, lines: mailLines, totalCents: priced.total_cents, undo });
      } else if (priced.total_cents > 0) {
        const account = await killbill.accountFor(`kerf-user-${user.id}`, user.name, user.email);
        const auth = await killbill.authorize(account, ref, priced.total_cents);
        undo.push(() => voidAuthorisation(auth, ref));
        await killbill.recordTransaction(tx, auth.paymentId, auth.tx, { orderRef: ref });
        const captured = await killbill.capture(auth.paymentId, ref, priced.total_cents);
        await killbill.recordTransaction(tx, auth.paymentId, captured, { orderRef: ref });
        await tx.query("UPDATE orders SET kb_payment_id = $2 WHERE id = $1", [id, auth.paymentId]);
      }
      await moveLines(tx, lineIds, "captured");
      const attachments = documents.map((content, i) => ({ filename: `${codes[i]}.pdf`, content }));
      const mailId = await queueMail(tx, mails.orderConfirmed(user.email, ref, mailLines, attachments));
      await tx.query("UPDATE orders SET confirmation_outbox_id = $2 WHERE id = $1", [id, mailId]);
      return id;
    });
    return orderId;
  } catch (error) {
    for (const step of undo.reverse()) await step().catch((e: unknown) => console.error("checkout compensation failed", e));
    throw error;
  }
}

route("POST", "/api/checkout", ["visitor", "group_booker"], async (ctx) => {
  const orderId = await checkout(ctx);
  return ok(await orderView(db, orderId), 201);
}, { idempotent: true });
