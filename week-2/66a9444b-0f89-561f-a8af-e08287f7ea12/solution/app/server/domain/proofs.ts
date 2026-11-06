// Reduced-rate proofs: uploaded privately, read by box office through signed links, decided before the
// deadline (capture on approval, void on rejection) or lapsing to a void at the deadline.
import { db, transaction, type Db } from "../db/index.ts";
import { ApiError, FieldErrors, notFound, ok, route } from "../http.ts";
import { checkUpload } from "../services/files.ts";
import * as killbill from "../services/killbill.ts";
import { getObject, objectKeys, putAll, putObject, removeAll } from "../services/storage.ts";
import { audit } from "./audit.ts";
import { newId, newPassCode } from "./ids.ts";
import { mails } from "./mails.ts";
import { linesOf, moveLines, orderView, passDocument, visibleOrder } from "./orders.ts";
import { queueMail } from "./outbox.ts";
import { queueTask } from "./refunds.ts";
import { settleSession } from "./seats.ts";
import { signedLink } from "./signedLinks.ts";
import { isoUtc } from "./time.ts";
import { recordMovement } from "./vouchers.ts";
import { asObject } from "./validate.ts";

const PROOF_LIMIT = 5_000_000;
const KINDS = ["student", "jobseeker"];

type ProofRow = { id: string; order_id: string; order_ref: string; kind: string; status: string; uploaded_at: Date; deadline: Date; content_type: string; size_bytes: number; buyer_name: string };

const PROOF_SELECT = `SELECT p.id, p.order_id, o.ref AS order_ref, p.kind, p.status, p.uploaded_at, o.proof_deadline AS deadline, p.content_type,
  p.size_bytes, u.name AS buyer_name FROM proofs p JOIN orders o ON o.id = p.order_id JOIN users u ON u.id = o.buyer_id`;

function proofView(p: ProofRow) {
  return { id: p.id, order_id: p.order_id, order_ref: p.order_ref, kind: p.kind, status: p.status, uploaded_at: isoUtc(p.uploaded_at),
    deadline: isoUtc(p.deadline), content_type: p.content_type, size_bytes: p.size_bytes };
}

route("POST", "/api/orders/:id/proof", ["visitor"], async (ctx) => {
  const order = await visibleOrder(db, ctx.user, ctx.params.id!);
  const proof = await transaction(async (tx) => {
    const lines = await linesOf(tx, [order.id]);
    if (!lines.some((l) => l.state === "proof_pending")) throw new ApiError(409, "not_proof_pending");
    if (await tx.one("SELECT 1 FROM proofs WHERE order_id = $1 FOR UPDATE", [order.id])) throw new ApiError(409, "proof_already_uploaded");
    const checked = checkUpload(ctx.upload.file, ["application/pdf", "image/jpeg", "image/png"]);
    const errors: Record<string, string> = {};
    if ("error" in checked) errors.file = checked.error;
    if (!KINDS.includes(ctx.upload.fields.kind ?? "")) errors.kind = "unknown";
    if (Object.keys(errors).length || "error" in checked) throw new FieldErrors(errors);
    const id = newId();
    await tx.query("INSERT INTO proofs (id, order_id, kind, status, uploaded_at, content_type, size_bytes) VALUES ($1,$2,$3,'pending',$4,$5,$6)",
      [id, order.id, ctx.upload.fields.kind!, new Date(), checked.type, checked.file.data.length]);
    await putObject(objectKeys.proof(order.ref, id), checked.file.data, checked.type);
    return (await tx.one<ProofRow>(`${PROOF_SELECT} WHERE p.id = $1`, [id]))!;
  });
  return ok(proofView(proof), 201);
}, { multipartLimit: PROOF_LIMIT });

route("GET", "/api/box-office/proofs", ["box_office"], async (ctx) => {
  const status = ctx.query.get("status");
  const rows = await db.all<ProofRow>(`${PROOF_SELECT} WHERE ($1::text IS NULL OR p.status = $1) ORDER BY p.uploaded_at`, [status]);
  return ok({ proofs: rows.map((p) => ({ ...proofView(p), buyer_name: p.buyer_name })) });
});

route("POST", "/api/box-office/proofs/:id/read", ["box_office"], async (ctx) => {
  const proof = await db.one<ProofRow>(`${PROOF_SELECT} WHERE p.id = $1`, [ctx.params.id!]);
  if (!proof) throw notFound();
  return ok(await signedLink({ kind: "proof", id: proof.id }));
});

/** The proof's decision window: open while server time is strictly before the order's deadline. */
async function decisionOpen(q: Db, orderId: string): Promise<boolean> {
  return (await q.one<{ live: boolean }>("SELECT is_live(proof_deadline, $2) AS live FROM orders WHERE id = $1", [orderId, new Date()]))!.live;
}

route("POST", "/api/box-office/proofs/:id/decision", ["box_office"], async (ctx) => {
  const body = asObject(ctx.body);
  const stored: string[] = [];
  try {
    const result = await transaction(async (tx) => {
      const proof = await tx.one<ProofRow>(`${PROOF_SELECT} WHERE p.id = $1 FOR UPDATE OF p, o`, [ctx.params.id!]);
      if (!proof) throw notFound();
      if (proof.status === "expired" || (proof.status === "pending" && !(await decisionOpen(tx, proof.order_id)))) {
        throw new ApiError(409, "proof_hold_expired");
      }
      if (proof.status !== "pending") throw new ApiError(409, "already_decided");
      const decision = body.decision;
      const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 1000) : "";
      if (decision !== "approve" && decision !== "reject") throw new FieldErrors({ decision: "unknown" });
      if (decision === "reject" && !reason) throw new FieldErrors({ reason: "required" });
      const order = (await tx.one<{ id: string; ref: string; kb_payment_id: string | null; voucher_code: string | null; buyer_email: string }>(
        "SELECT o.id, o.ref, o.kb_payment_id, o.voucher_code, u.email AS buyer_email FROM orders o JOIN users u ON u.id = o.buyer_id WHERE o.id = $1", [proof.order_id]))!;
      const pending = (await linesOf(tx, [order.id])).filter((l) => l.state === "proof_pending");
      const now = new Date();
      if (decision === "approve") {
        // Passes first; the capture happens only once every pass is stored.
        const codes = pending.map(() => newPassCode());
        const documents = await Promise.all(pending.map((l, i) => passDocument(tx, l, codes[i]!)));
        const objects = pending.map((_, i) => ({ key: objectKeys.pass(order.ref, codes[i]!), body: documents[i]!, contentType: "application/pdf" }));
        await putAll(objects);
        stored.push(...objects.map((o) => o.key));
        const amount = pending.reduce((s, l) => s + l.charged_cents, 0);
        if (amount > 0 && order.kb_payment_id) {
          const captured = await killbill.capture(order.kb_payment_id, order.ref, amount);
          await killbill.recordTransaction(tx, order.kb_payment_id, captured, { orderRef: order.ref });
        }
        await moveLines(tx, pending.map((l) => l.id), "captured");
        for (const [i, l] of pending.entries()) await tx.query("INSERT INTO passes (code, line_id, status, created_at) VALUES ($1, $2, 'valid', $3)", [codes[i]!, l.id, now]);
        await queueMail(tx, mails.proofApproved(order.buyer_email, order.ref, documents.map((content, i) => ({ filename: `${codes[i]}.pdf`, content }))));
      } else {
        if (order.kb_payment_id) {
          const voided = await killbill.voidPayment(order.kb_payment_id, order.ref);
          await killbill.recordTransaction(tx, order.kb_payment_id, voided, { orderRef: order.ref });
        }
        await moveLines(tx, pending.map((l) => l.id), "voided");
        const voucher = pending.reduce((s, l) => s + l.voucher_cents, 0);
        if (voucher > 0) await recordMovement(tx, "return", order.voucher_code!, voucher, ctx.user.email, order.ref);
        await queueMail(tx, mails.proofRejected(order.buyer_email, order.ref, reason));
        for (const sessionId of new Set(pending.map((l) => l.session_id).filter((s): s is string => !!s))) await settleSession(tx, sessionId, now);
      }
      await tx.query("UPDATE proofs SET status = $2, decided_at = $3, decided_by = $4, reason = $5 WHERE id = $1",
        [proof.id, decision === "approve" ? "approved" : "rejected", now, ctx.user.email, reason || null]);
      await audit(tx, ctx.user, decision === "approve" ? "proof.approved" : "proof.rejected", { type: "proof", id: proof.id }, { order_ref: order.ref, reason: reason || null });
      return { proofId: proof.id, orderId: order.id };
    });
    const proof = (await db.one<ProofRow>(`${PROOF_SELECT} WHERE p.id = $1`, [result.proofId]))!;
    return ok({ proof: proofView(proof), order: await orderView(db, result.orderId) });
  } catch (error) {
    await removeAll(stored);
    throw error;
  }
});

/** The worker's pass: proof-pending orders whose deadline has come lapse; their authorisation is voided. */
export async function proofLapseSweep(): Promise<void> {
  for (;;) {
    const handled = await transaction(async (tx) => {
      const now = new Date();
      const order = await tx.one<{ id: string; ref: string; voucher_code: string | null; kb_payment_id: string | null; buyer_email: string }>(
        `SELECT o.id, o.ref, o.voucher_code, o.kb_payment_id, u.email AS buyer_email FROM orders o JOIN users u ON u.id = o.buyer_id
         WHERE NOT is_live(o.proof_deadline, $1) AND EXISTS (SELECT 1 FROM lines l WHERE l.order_id = o.id AND l.state = 'proof_pending')
         LIMIT 1 FOR UPDATE OF o SKIP LOCKED`, [now]);
      if (!order) return false;
      const pending = (await linesOf(tx, [order.id])).filter((l) => l.state === "proof_pending");
      await moveLines(tx, pending.map((l) => l.id), "expired");
      const voucher = pending.reduce((s, l) => s + l.voucher_cents, 0);
      if (voucher > 0) await recordMovement(tx, "return", order.voucher_code!, voucher, "system", order.ref);
      await tx.query("UPDATE proofs SET status = 'expired' WHERE order_id = $1 AND status = 'pending'", [order.id]);
      if (order.kb_payment_id) await queueTask(tx, "void", order.id);
      await queueMail(tx, mails.proofLapsed(order.buyer_email, order.ref));
      await audit(tx, "system", "proof.lapsed", { type: "order", id: order.id }, { order_ref: order.ref });
      for (const sessionId of new Set(pending.map((l) => l.session_id).filter((s): s is string => !!s))) await settleSession(tx, sessionId, now);
      return true;
    });
    if (!handled) return;
  }
}

export async function proofBytes(id: string): Promise<{ bytes: Buffer; contentType: string } | null> {
  const proof = await db.one<{ order_ref: string; content_type: string }>(`${PROOF_SELECT} WHERE p.id = $1`, [id]);
  return proof ? { bytes: await getObject(objectKeys.proof(proof.order_ref, id)), contentType: proof.content_type } : null;
}
