import { MemberRow, MembershipRow, findMembership } from '../data';
import { newId, nextCounter, query } from '../db';
import { Cadence } from '../shared/money';
import { PRACTICE_ZONE, localDate } from '../shared/time';
import * as killBill from './killbill';

const CONFIRMATION_BUDGET_MS = 10000;

export async function membershipOf(memberId: string): Promise<MembershipRow> {
  const found = await findMembership(memberId);
  if (found) return found;
  await query('insert into memberships (member_id) values ($1) on conflict do nothing', [memberId]);
  const created = await findMembership(memberId);
  if (!created) throw new Error(`No membership row for ${memberId}`);
  return created;
}

async function saveMembership(memberId: string, patch: Partial<MembershipRow>): Promise<MembershipRow> {
  const columns = Object.keys(patch);
  if (columns.length > 0) {
    const assignments = columns.map((column, index) => `${column} = $${index + 2}`).join(', ');
    await query(`update memberships set ${assignments} where member_id = $1`, [
      memberId,
      ...columns.map((column) => (patch as Record<string, unknown>)[column]),
    ]);
  }
  return membershipOf(memberId);
}

export async function ensureKillBillAccount(member: MemberRow): Promise<string> {
  if (member.killbill_account_id) return member.killbill_account_id;
  const accountId = await killBill.createAccount({
    externalKey: member.id,
    name: member.name ?? 'Member',
    email: member.email ?? '',
  });
  await query('update members set killbill_account_id = $2 where id = $1', [member.id, accountId]);
  return accountId;
}

/** Records every paid Kill Bill invoice of the account as a receipt, once. */
export async function recordReceipts(member: MemberRow, accountId: string): Promise<void> {
  const invoices = await killBill.listPaidInvoices(accountId);
  invoices.sort((left, right) => left.paidAt.localeCompare(right.paidAt));
  for (const invoice of invoices) {
    const existing = await query<{ id: string }>('select id from receipts where invoice_id = $1', [
      invoice.invoiceId,
    ]);
    if (existing.length > 0) continue;
    const number = await nextCounter('receipt');
    await query(
      `insert into receipts (id, member_id, number_seq, invoice_id, paid_at, paid_date, amount_cents, currency, items)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (invoice_id) do nothing`,
      [
        newId(),
        member.id,
        number,
        invoice.invoiceId,
        invoice.paidAt,
        localDate(new Date(invoice.paidAt), PRACTICE_ZONE),
        invoice.amountCents,
        invoice.currency,
        JSON.stringify(invoice.items),
      ],
    );
  }
}

/** Reads Kill Bill and brings the stored membership in line with what it reports. */
export async function refreshFromKillBill(
  member: MemberRow,
  membership: MembershipRow,
): Promise<MembershipRow> {
  if (!membership.subscription_id || !member.killbill_account_id) return membership;
  const subscription = await killBill.readSubscription(membership.subscription_id);
  if (!subscription) return membership;
  await recordReceipts(member, member.killbill_account_id);
  const paid = await query<{ count: string }>(
    'select count(*)::text as count from receipts where member_id = $1',
    [member.id],
  );
  const hasPaidInvoice = Number(paid[0]?.count ?? '0') > 0;
  const patch: Partial<MembershipRow> = {};
  const chargedThrough = subscription.chargedThroughDate;
  if (subscription.cancelledDate) {
    patch.state = 'cancelled';
    patch.plus_until = chargedThrough;
    patch.renewal_date = null;
  } else if (hasPaidInvoice) {
    patch.state = 'active';
    patch.renewal_date = chargedThrough;
    patch.plus_until = null;
  }
  if (!subscription.cancelledDate && subscription.cadence !== membership.cadence) {
    patch.pending_cadence = subscription.cadence;
    patch.pending_from = chargedThrough;
  }
  const today = localDate(new Date(), PRACTICE_ZONE);
  if (
    (patch.state ?? membership.state) === 'cancelled' &&
    (patch.plus_until ?? membership.plus_until) !== null &&
    (patch.plus_until ?? membership.plus_until) as string < today
  ) {
    patch.state = 'free';
    patch.cadence = null;
    patch.renewal_date = null;
    patch.plus_until = null;
    patch.pending_cadence = null;
    patch.pending_from = null;
  }
  return saveMembership(member.id, patch);
}

/** Starts Plus in Kill Bill and waits up to 10 seconds for its confirmation. */
export async function startPlus(member: MemberRow, cadence: Cadence): Promise<MembershipRow> {
  const accountId = await ensureKillBillAccount(member);
  let subscriptionId: string;
  try {
    subscriptionId = await killBill.createSubscription(accountId, cadence, CONFIRMATION_BUDGET_MS);
  } catch (error) {
    await killBill.deleteAccountSubscriptions(accountId).catch(() => undefined);
    throw error;
  }
  await saveMembership(member.id, {
    state: 'pending',
    cadence,
    subscription_id: subscriptionId,
    renewal_date: null,
    plus_until: null,
    pending_cadence: null,
    pending_from: null,
    cancelled_before_closure: false,
  });
  const deadline = Date.now() + CONFIRMATION_BUDGET_MS;
  for (;;) {
    const membership = await membershipOf(member.id);
    const refreshed = await refreshFromKillBill({ ...member, killbill_account_id: accountId }, membership);
    if (refreshed.state === 'active') return refreshed;
    if (Date.now() >= deadline) return refreshed;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

export async function changeCadence(
  member: MemberRow,
  membership: MembershipRow,
  cadence: Cadence,
): Promise<MembershipRow> {
  if (!membership.subscription_id) throw new Error('No subscription to change');
  const settled = await refreshFromKillBill(member, membership);
  await killBill.changePlan(settled.subscription_id as string, cadence);
  const subscription = await killBill.readSubscription(settled.subscription_id as string);
  return saveMembership(member.id, {
    pending_cadence: cadence,
    pending_from: subscription?.chargedThroughDate ?? settled.renewal_date,
  });
}

export async function cancelPlus(
  member: MemberRow,
  membership: MembershipRow,
): Promise<MembershipRow> {
  if (!membership.subscription_id) throw new Error('No subscription to cancel');
  const settled = await refreshFromKillBill(member, membership);
  await killBill.cancelSubscription(settled.subscription_id as string);
  const subscription = await killBill.readSubscription(settled.subscription_id as string);
  return saveMembership(member.id, {
    state: 'cancelled',
    plus_until: subscription?.chargedThroughDate ?? settled.renewal_date,
    renewal_date: null,
  });
}

export async function uncancelPlus(
  member: MemberRow,
  membership: MembershipRow,
): Promise<MembershipRow> {
  if (!membership.subscription_id) return membership;
  await killBill.uncancelSubscription(membership.subscription_id);
  const subscription = await killBill.readSubscription(membership.subscription_id);
  return saveMembership(member.id, {
    state: 'active',
    renewal_date: subscription?.chargedThroughDate ?? null,
    plus_until: null,
  });
}

export function startMembershipLoop(): void {
  const tick = async (): Promise<void> => {
    try {
      const members = await query<MemberRow>(
        `select m.* from members m
         join memberships s on s.member_id = m.id
         where s.subscription_id is not null and m.account_state <> 'erased'`,
      );
      for (const member of members) {
        const membership = await membershipOf(member.id);
        await refreshFromKillBill(member, membership).catch(() => undefined);
      }
    } catch {
      // The next tick tries again.
    }
    setTimeout(() => void tick(), 20000);
  };
  setTimeout(() => void tick(), 30000);
}
