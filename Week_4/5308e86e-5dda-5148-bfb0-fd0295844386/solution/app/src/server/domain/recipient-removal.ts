/** Removing a recipient: history stays, scheduled payments are cancelled, held payments block. */
import { transaction } from "../db.js";
import { forbidden, notFound, refusal } from "../http/errors.js";
import type { SessionUser } from "../http/context.js";
import { isId } from "../ids.js";
import { cancelScheduled, expirePayment } from "./payments.js";

export async function removeRecipient(user: SessionUser, id: unknown, now: Date): Promise<void> {
  await transaction(async (tx) => {
    if (!isId(id)) throw notFound();
    const found = await tx.query("SELECT * FROM recipients WHERE id = $1 AND company_id = $2 FOR UPDATE", [id, user.companyId]);
    const recipient = found.rows[0];
    if (!recipient || recipient.status === "removed") throw notFound();
    if (user.role === "member") throw forbidden();

    const held = await tx.query("SELECT * FROM payments WHERE status = 'pending_approval' AND recipient_id = $1 ORDER BY created_at, id FOR UPDATE", [recipient.id]);
    for (const payment of held.rows) {
      if (now.getTime() < (payment.expires_at as Date).getTime()) throw refusal(409, "recipient_has_pending_payments");
      await expirePayment(tx, payment);
    }
    const scheduled = await tx.query("SELECT * FROM payments WHERE recipient_id = $1 AND status = 'scheduled' ORDER BY created_at, id FOR UPDATE", [recipient.id]);
    for (const payment of scheduled.rows) await cancelScheduled(tx, payment, user.email);
    await tx.query("UPDATE recipients SET status = 'removed', removed_at = $2 WHERE id = $1", [recipient.id, now]);
  });
}
