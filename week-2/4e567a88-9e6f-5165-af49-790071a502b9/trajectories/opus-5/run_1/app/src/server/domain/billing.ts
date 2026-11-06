import { lockTeam, tx } from '../db';
import { noteBillingFailure } from '../services/deps';
import {
  BillingRejected,
  BillingUnavailable,
  accountForTeam,
  createExternalCharge,
  findInvoiceByDescription,
  payInvoice,
  successfulPurchaseOf,
} from '../services/killbill';
import { noticeTopupReceipt } from '../services/notices';
import { recordMovement } from '../store/ledger';
import { memberById, teamById } from '../store/people';
import {
  TopupRecord,
  markFailed,
  markPaidOnce,
  markPending,
  storeBillingIds,
  topupById,
} from '../store/topups';
import { MICRO_PER_CREDIT } from './money';

const RETRY_SECONDS = 15;
export const PENDING_REASON = 'billing_unavailable';
export const REJECTED_REASON = 'billing_rejected';

export type TopupOutcome =
  | { kind: 'paid'; topup: TopupRecord }
  | { kind: 'pending'; topup: TopupRecord }
  | { kind: 'rejected'; topup: TopupRecord };

function invoiceDescription(topupId: string): string {
  return `Dispatch credits ${topupId}`;
}

async function reload(id: string): Promise<TopupRecord> {
  const topup = await topupById(id);
  if (!topup) throw new Error(`Top-up ${id} vanished`);
  return topup;
}

/**
 * Carries a top-up as far as Kill Bill allows, reusing whatever Kill Bill already holds,
 * so a timed-out call never makes a second invoice or payment.
 */
export async function advanceTopup(topup: TopupRecord): Promise<TopupOutcome> {
  const team = await teamById(topup.teamId);
  if (!team) throw new Error(`Top-up ${topup.id} names unknown team ${topup.teamId}`);
  const amountUsd = Number(topup.credits) / 100;
  try {
    const accountId = topup.kbAccountId ?? (await accountForTeam(team.id, team.name));
    if (accountId !== topup.kbAccountId) await storeBillingIds(topup.id, { accountId });

    let invoiceId = topup.kbInvoiceId;
    if (!invoiceId) {
      const existing = await findInvoiceByDescription(accountId, invoiceDescription(topup.id));
      invoiceId = existing ? existing.invoiceId : await createExternalCharge(accountId, amountUsd, invoiceDescription(topup.id));
      await storeBillingIds(topup.id, { invoiceId });
    }

    let paymentId = topup.kbPaymentId ?? (await successfulPurchaseOf(invoiceId));
    if (!paymentId) paymentId = await payInvoice(accountId, invoiceId, amountUsd);
    await storeBillingIds(topup.id, { paymentId });

    const granted = await tx(async (client) => {
      await lockTeam(client, team.id);
      if (!(await markPaidOnce(client, topup.id))) return false;
      await recordMovement(client, {
        teamId: team.id,
        kind: 'top_up',
        minus: 'funding',
        plus: 'available',
        amountMicro: topup.credits * MICRO_PER_CREDIT,
        topupId: topup.id,
        kbInvoiceId: invoiceId,
      });
      return true;
    });
    const paid = await reload(topup.id);
    if (granted) {
      const requester = await memberById(paid.createdBy);
      if (requester) await noticeTopupReceipt(requester, team, paid);
    }
    return { kind: 'paid', topup: paid };
  } catch (error) {
    if (error instanceof BillingUnavailable) {
      noteBillingFailure();
      await markPending(topup.id, PENDING_REASON, new Date(Date.now() + RETRY_SECONDS * 1000));
      return { kind: 'pending', topup: await reload(topup.id) };
    }
    if (error instanceof BillingRejected) {
      await markFailed(topup.id, REJECTED_REASON);
      return { kind: 'rejected', topup: await reload(topup.id) };
    }
    throw error;
  }
}
