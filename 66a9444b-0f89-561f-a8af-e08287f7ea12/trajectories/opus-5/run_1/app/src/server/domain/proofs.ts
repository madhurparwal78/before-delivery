import { many, one, type Queryable } from '../db/pool.js';
import { newId } from '../lib/codes.js';
import { toUtcIso } from '../lib/time.js';
import * as killbill from '../services/killbill.js';
import { deleteObject } from '../services/storage.js';
import { queueMail } from '../services/mail.js';
import { issuePass, loadOrder, orderLines, passFileName, type OrderRow } from './orders.js';
import { recordPayment } from './payments.js';
import { offerFreedSeats } from './seats.js';
import { recordMovement } from './vouchers.js';

export interface ProofRow {
  id: string;
  order_id: string;
  order_ref: string;
  buyer_name: string;
  kind: 'student' | 'jobseeker';
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  uploaded_at: Date;
  deadline: Date;
  content_type: string;
  size_bytes: number;
  object_key: string;
}

const PROOF_COLUMNS = `p.id, p.order_id, o.ref AS order_ref, u.name AS buyer_name, p.kind,
  p.status, p.uploaded_at, p.deadline, p.content_type, p.size_bytes, p.object_key`;

export interface SerialisedProof {
  id: string;
  order_id: string;
  order_ref: string;
  kind: 'student' | 'jobseeker';
  status: ProofRow['status'];
  uploaded_at: string;
  deadline: string;
  content_type: string;
  size_bytes: number;
}

/** A proof never reports its storage key or file name. */
export function serialiseProof(row: ProofRow): SerialisedProof {
  return {
    id: row.id,
    order_id: row.order_id,
    order_ref: row.order_ref,
    kind: row.kind,
    status: row.status,
    uploaded_at: toUtcIso(row.uploaded_at),
    deadline: toUtcIso(row.deadline),
    content_type: row.content_type,
    size_bytes: row.size_bytes,
  };
}

export async function loadProof(db: Queryable, id: string): Promise<ProofRow | null> {
  return one<ProofRow>(
    db,
    `SELECT ${PROOF_COLUMNS} FROM proofs p
     JOIN orders o ON o.id = p.order_id JOIN users u ON u.id = o.user_id WHERE p.id = $1`,
    [id],
  );
}

export async function loadProofForOrder(
  db: Queryable,
  orderId: string,
): Promise<ProofRow | null> {
  return one<ProofRow>(
    db,
    `SELECT ${PROOF_COLUMNS} FROM proofs p
     JOIN orders o ON o.id = p.order_id JOIN users u ON u.id = o.user_id WHERE p.order_id = $1`,
    [orderId],
  );
}

export async function listProofs(
  db: Queryable,
  status: string | null,
): Promise<ProofRow[]> {
  if (status === null) {
    return many<ProofRow>(
      db,
      `SELECT ${PROOF_COLUMNS} FROM proofs p
       JOIN orders o ON o.id = p.order_id JOIN users u ON u.id = o.user_id
       ORDER BY p.uploaded_at`,
    );
  }
  return many<ProofRow>(
    db,
    `SELECT ${PROOF_COLUMNS} FROM proofs p
     JOIN orders o ON o.id = p.order_id JOIN users u ON u.id = o.user_id
     WHERE p.status = $1 ORDER BY p.uploaded_at`,
    [status],
  );
}

export async function insertProof(
  db: Queryable,
  order: OrderRow,
  id: string,
  kind: 'student' | 'jobseeker',
  contentType: string,
  sizeBytes: number,
  objectKey: string,
): Promise<ProofRow> {
  await db.query(
    `INSERT INTO proofs (id, order_id, kind, status, uploaded_at, deadline, content_type,
       size_bytes, object_key)
     VALUES ($1, $2, $3, 'pending', now(), $4, $5, $6, $7)`,
    [id, order.id, kind, order.proof_deadline, contentType, sizeBytes, objectKey],
  );
  const row = await loadProof(db, id);
  if (row === null) throw new Error('proof insert failed');
  return row;
}

export function newProofId(): string {
  return newId();
}

/**
 * Approval is all-or-nothing: every pass is stored first and the capture happens only once they
 * are, so a payment outage after storage leaves nothing behind.
 */
export async function approveProof(
  db: Queryable,
  proof: ProofRow,
  actor: string,
): Promise<void> {
  const order = await loadOrder(db, proof.order_id);
  if (order === null) throw new Error('order missing for proof');
  const lines = (await orderLines(db, order.id)).filter((line) => line.state === 'proof_pending');
  const storedKeys: string[] = [];
  const attachments: Array<{ filename: string; key: string }> = [];

  for (const line of lines) {
    const issued = await issuePass(db, order, line, line.holder_name);
    storedKeys.push(issued.objectKey);
    attachments.push({ filename: passFileName(issued.code), key: issued.objectKey });
  }

  const captureCents = lines.reduce((sum, line) => sum + line.charged_cents, 0);
  if (captureCents > 0 && order.killbill_payment_id !== null) {
    try {
      const captured = await killbill.capture(order.killbill_payment_id, order.ref, captureCents);
      await recordPayment(db, { orderId: order.id, transaction: captured });
    } catch (error) {
      for (const key of storedKeys) {
        try {
          await deleteObject(key);
        } catch {
          // leave the orphan behind rather than mask the payment outage
        }
      }
      throw error;
    }
  }

  await db.query(
    `UPDATE order_lines SET state = 'captured' WHERE order_id = $1 AND state = 'proof_pending'`,
    [order.id],
  );
  await db.query(
    `UPDATE proofs SET status = 'approved', decided_by = $2, decided_at = now() WHERE id = $1`,
    [proof.id, actor],
  );

  await queueMail(db, {
    eventKey: `proof-approved:${proof.id}`,
    to: order.buyer_email,
    subject: `Reduced rate approved — order ${order.ref}`,
    body: [
      `Your reduced rate for order ${order.ref} is approved.`,
      '',
      'Your passes are attached.',
    ].join('\n'),
    attachments,
  });
}

export async function rejectProof(
  db: Queryable,
  proof: ProofRow,
  reason: string,
  actor: string,
): Promise<void> {
  const order = await loadOrder(db, proof.order_id);
  if (order === null) throw new Error('order missing for proof');
  await voidPendingLines(db, order, 'voided');
  await db.query(
    `UPDATE proofs SET status = 'rejected', decided_by = $2, decided_at = now(), reason = $3
     WHERE id = $1`,
    [proof.id, actor, reason],
  );
  await queueMail(db, {
    eventKey: `proof-rejected:${proof.id}`,
    to: order.buyer_email,
    subject: `Reduced rate not approved — order ${order.ref}`,
    body: [
      `Your reduced rate for order ${order.ref} was not approved.`,
      '',
      `Reason: ${reason}`,
      '',
      'Your payment authorisation was released.',
    ].join('\n'),
  });
}

export async function lapseProofHold(db: Queryable, orderId: string): Promise<void> {
  const order = await loadOrder(db, orderId);
  if (order === null) return;
  await voidPendingLines(db, order, 'expired');
  await db.query(`UPDATE proofs SET status = 'expired' WHERE order_id = $1 AND status = 'pending'`, [
    orderId,
  ]);
  await queueMail(db, {
    eventKey: `proof-lapsed:${orderId}`,
    to: order.buyer_email,
    subject: `Reduced-rate hold expired — order ${order.ref}`,
    body: [
      `The proof deadline for order ${order.ref} has passed.`,
      '',
      'Your payment authorisation was released and nothing was taken.',
    ].join('\n'),
  });
}

/** Voids the authorisation, settles the lines and returns any voucher shares. */
async function voidPendingLines(
  db: Queryable,
  order: OrderRow,
  state: 'voided' | 'expired',
): Promise<void> {
  const lines = (await orderLines(db, order.id)).filter((line) => line.state === 'proof_pending');
  if (lines.length === 0) return;

  if (order.killbill_payment_id !== null) {
    const voided = await killbill.voidPayment(order.killbill_payment_id, order.ref);
    await recordPayment(db, { orderId: order.id, transaction: voided });
  }

  await db.query(`UPDATE order_lines SET state = $2 WHERE id = ANY($1::uuid[])`, [
    lines.map((line) => line.id),
    state,
  ]);
  await db.query(
    `UPDATE passes SET status = 'voided' WHERE line_id = ANY($1::uuid[]) AND status = 'valid'`,
    [lines.map((line) => line.id)],
  );

  const voucherReturn = lines.reduce((sum, line) => sum + line.voucher_cents, 0);
  if (order.voucher_code !== null && voucherReturn > 0) {
    await recordMovement(db, {
      kind: 'return',
      code: order.voucher_code,
      amountCents: voucherReturn,
      actor: 'system',
      orderRef: order.ref,
    });
  }

  const freedPerSession = new Map<string, number>();
  for (const line of lines) {
    if (line.session_id === null) continue;
    freedPerSession.set(line.session_id, (freedPerSession.get(line.session_id) ?? 0) + 1);
  }
  for (const [sessionId, freed] of freedPerSession) {
    await offerFreedSeats(db, sessionId, freed);
  }
}
