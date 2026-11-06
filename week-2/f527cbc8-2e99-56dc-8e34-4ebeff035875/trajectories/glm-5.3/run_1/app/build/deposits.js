import { withTx } from './db.js';
import { now } from './time.js';
import * as kb from './killbill.js';
import { newId } from './domain.js';
export async function createRefundRow(tx, paymentId, amountCents) {
    const id = newId('rfd');
    await tx.query(`insert into refunds(id, payment_id, amount_cents, killbill_status, pending_since, created_at)
     values($1,$2,$3,'pending',$4,$5)`, [id, paymentId, amountCents, now(), now()]);
    return id;
}
export async function pushRefund(killbillAccountId, killbillPaymentId, refundId) {
    if (!killbillAccountId || !killbillPaymentId)
        return false;
    try {
        const amount = await refundAmount(refundId);
        await kb.createRefund(killbillAccountId, killbillPaymentId, amount, refundId);
        await completeRefund(refundId);
        return true;
    }
    catch {
        return false;
    }
}
async function refundAmount(refundId) {
    const rows = await withTx(tx => tx.query(`select amount_cents from refunds where id = $1`, [refundId]));
    return rows[0]?.amount_cents ?? 0;
}
async function completeRefund(refundId) {
    await withTx(tx => tx.query(`update refunds set killbill_status = 'recorded', pending_since = null, ledger_at = $2 where id = $1`, [refundId, now()]));
}
export async function refundRecorded(refundId) {
    const rows = await withTx(tx => tx.query(`select killbill_status from refunds where id = $1`, [refundId]));
    return rows[0]?.killbill_status === 'recorded';
}
