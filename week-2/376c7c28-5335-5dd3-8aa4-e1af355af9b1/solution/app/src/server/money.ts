import { now } from './clock.ts';
import { first, lockKey, lockAll, pool, rows, transaction, type Queryable } from './db/pool.ts';
import { chooseFunding, type CardStatus, type Funding } from './domain/funding.ts';
import { formatDollars, signedDollarLabel } from './domain/money.ts';
import { publish } from './events.ts';
import { newId } from './security.ts';
import { formatStudioDate } from '../shared/labels.ts';
import * as kb from './services/killbill.ts';
import { BillingTimeout, BillingUnavailable } from './services/killbill.ts';

type MovementKind =
  | 'opening'
  | 'pack'
  | 'firing_fee'
  | 'storage_fee'
  | 'refund'
  | 'adjustment';

type Account = 'member_credit' | 'card_receipts' | 'firing_revenue' | 'adjustments';

interface Pair {
  readonly debit: { account: Account; amount: number };
  readonly credit: { account: Account; amount: number };
}

/** The ledger table from the brief, written in exactly one place. */
function feePair(funding: Funding, feeCents: number): Pair {
  return funding === 'credit'
    ? {
        debit: { account: 'member_credit', amount: -feeCents },
        credit: { account: 'firing_revenue', amount: feeCents },
      }
    : {
        debit: { account: 'card_receipts', amount: -feeCents },
        credit: { account: 'firing_revenue', amount: feeCents },
      };
}

function refundPair(funding: Funding, feeCents: number): Pair {
  return funding === 'credit'
    ? {
        debit: { account: 'member_credit', amount: feeCents },
        credit: { account: 'firing_revenue', amount: -feeCents },
      }
    : {
        debit: { account: 'card_receipts', amount: feeCents },
        credit: { account: 'firing_revenue', amount: -feeCents },
      };
}

export function packPair(amountCents: number): Pair {
  return {
    debit: { account: 'member_credit', amount: amountCents },
    credit: { account: 'card_receipts', amount: -amountCents },
  };
}

export function adjustmentPair(amountCents: number): Pair {
  return {
    debit: { account: 'member_credit', amount: amountCents },
    credit: { account: 'adjustments', amount: -amountCents },
  };
}

export function memberMoneyLock(memberId: string): bigint {
  return lockKey('member-money', memberId);
}

export async function postPair(
  client: Queryable,
  studioId: string,
  memberId: string,
  kind: MovementKind,
  chargeId: string | null,
  pair: Pair,
): Promise<string> {
  const movementId = newId();
  const at = now();
  await client.query(
    'insert into ledger_movements (id, studio_id, member_id, kind, charge_id, created_at) values ($1,$2,$3,$4,$5,$6)',
    [movementId, studioId, memberId, kind, chargeId, at],
  );
  for (const entry of [pair.debit, pair.credit]) {
    await client.query(
      'insert into ledger_entries (id, movement_id, studio_id, member_id, account, amount_cents, created_at) values ($1,$2,$3,$4,$5,$6,$7)',
      [newId(), movementId, studioId, memberId, entry.account, entry.amount, at],
    );
  }
  return movementId;
}

export async function currentBalance(client: Queryable, memberId: string): Promise<number> {
  const found = await rows<{ balance: number }>(
    client,
    `select coalesce(sum(amount_cents), 0)::bigint as balance
       from ledger_entries where member_id = $1 and account = 'member_credit'`,
    [memberId],
  );
  return found[0]?.balance ?? 0;
}

export async function queueEmail(
  client: Queryable,
  studioId: string,
  to: string,
  subject: string,
  body: string,
): Promise<void> {
  await client.query(
    'insert into emails (id, studio_id, to_email, subject, body, created_at) values ($1,$2,$3,$4,$5,$6)',
    [newId(), studioId, to, subject, body, now()],
  );
}

interface KbAccountRow {
  readonly account_id: string;
  readonly card_pm_id: string | null;
  readonly credit_pm_id: string | null;
}

interface MemberRow {
  readonly id: string;
  readonly studio_id: string;
  readonly name: string;
  readonly email: string;
  readonly card_status: CardStatus;
}

const STORED_ACCOUNT_SQL =
  'select account_id, card_pm_id, credit_pm_id from kb_accounts where member_id = $1';

/**
 * The member's Kill Bill account and its two payment methods, created on first need. Setup for
 * one member runs one instance at a time, so racing first purchases never see a half-made account.
 */
export async function ensureBillingAccount(
  member: MemberRow,
  budgetMs: number,
): Promise<{ accountId: string; card: string; credit: string }> {
  const ready = await first<KbAccountRow>(pool, STORED_ACCOUNT_SQL, [member.id]);
  if (ready?.card_pm_id && ready.credit_pm_id) {
    return { accountId: ready.account_id, card: ready.card_pm_id, credit: ready.credit_pm_id };
  }
  return transaction(async (client) => {
    await lockAll(client, [lockKey('kb-account', member.id)]);
    const stored = await first<KbAccountRow>(client, STORED_ACCOUNT_SQL, [member.id]);
    if (stored?.card_pm_id && stored.credit_pm_id) {
      return { accountId: stored.account_id, card: stored.card_pm_id, credit: stored.credit_pm_id };
    }
    const externalKey = kb.accountExternalKey(member.id);
    const accountId =
      stored?.account_id ??
      (await kb.findAccount(externalKey, budgetMs)) ??
      (await kb.createAccount(externalKey, member.name, member.email, budgetMs));
    const methods = await kb.listPaymentMethods(accountId, budgetMs);
    const cardKey = kb.paymentMethodExternalKey(member.id, 'card');
    const creditKey = kb.paymentMethodExternalKey(member.id, 'credit');
    const card =
      methods.find((method) => method.externalKey === cardKey)?.paymentMethodId ??
      (await kb.createPaymentMethod(accountId, cardKey, true, budgetMs));
    const credit =
      methods.find((method) => method.externalKey === creditKey)?.paymentMethodId ??
      (await kb.createPaymentMethod(accountId, creditKey, false, budgetMs)) ??
      card;
    if (!card || !credit) throw new BillingUnavailable('billing holds no payment method for that member');
    await client.query(
      `insert into kb_accounts (member_id, account_id, card_pm_id, credit_pm_id)
       values ($1,$2,$3,$4)
       on conflict (member_id) do update set account_id = excluded.account_id,
         card_pm_id = excluded.card_pm_id, credit_pm_id = excluded.credit_pm_id`,
      [member.id, accountId, card, credit],
    );
    return { accountId, card, credit };
  });
}

interface SettleTargetRow {
  readonly id: string;
  readonly studio_id: string;
  readonly member_id: string;
  readonly piece_id: string;
  readonly firing: 'bisque' | 'glaze' | 'storage';
  readonly storage_day: string | null;
  readonly fee_cents: number;
  readonly funding: Funding | null;
  readonly piece_title: string;
  readonly member_name: string;
  readonly member_email: string;
  readonly card_status: CardStatus;
  readonly studio_name: string;
}

const CLAIM_SECONDS = 90;

/** The claim an unload puts on the charges it creates, so it settles them itself. */
export function unloadClaim(at: Date): Date {
  return new Date(at.getTime() + CLAIM_SECONDS * 1_000);
}

/**
 * Takes the charge for one settling attempt. A charge the caller already holds (an unload's own
 * fresh charges) is taken while it is pending and its member has no older charge still pending,
 * which the settler then settles first.
 */
async function claimCharge(chargeId: string, held: boolean): Promise<SettleTargetRow | null> {
  const at = now();
  const claimed = held
    ? await rows<{ id: string }>(
        pool,
        `select c.id from charges c
          where c.id = $1 and c.status = 'pending'
            and not exists (select 1 from charges o where o.member_id = c.member_id
                              and o.status = 'pending' and o.ordinal < c.ordinal)`,
        [chargeId],
      )
    : await rows<{ id: string }>(
        pool,
        `update charges set claimed_until = $2
          where id = $1 and status = 'pending' and (claimed_until is null or claimed_until < $3)
          returning id`,
        [chargeId, unloadClaim(at), at],
      );
  if (claimed.length === 0) return null;
  return first<SettleTargetRow>(
    pool,
    `select c.id, c.studio_id, c.member_id, c.piece_id, c.firing, c.storage_day, c.fee_cents,
            c.funding, p.title as piece_title, m.name as member_name, m.email as member_email,
            m.card_status, s.name as studio_name
       from charges c
       join pieces p on p.id = c.piece_id
       join people m on m.id = c.member_id
       join studios s on s.id = c.studio_id
      where c.id = $1`,
    [chargeId],
  );
}

async function releaseCharge(chargeId: string): Promise<void> {
  await pool.query('update charges set claimed_until = null where id = $1', [chargeId]);
}

function chargeTransactionKey(charge: SettleTargetRow): string {
  return charge.firing === 'storage'
    ? kb.storageTransactionKey(charge.piece_id, charge.storage_day as string)
    : kb.chargeTransactionKey(charge.id);
}

function receiptEmail(
  charge: SettleTargetRow,
  funding: Funding,
  balanceAfter: number,
): { subject: string; body: string } {
  const fundingLine = funding === 'credit' ? 'Paid from credit' : 'Paid by card';
  if (charge.firing === 'storage') {
    return {
      subject: `Storage fee: ${charge.piece_title}`,
      body: [
        charge.studio_name,
        `Storage, ${formatStudioDate(charge.storage_day as string)}`,
        `${charge.piece_title}`,
        `Fee $${formatDollars(charge.fee_cents)}`,
        fundingLine,
        `Balance after ${signedDollarLabel(balanceAfter)}`,
      ].join('\n'),
    };
  }
  return {
    subject: `Firing receipt: ${charge.piece_title}`,
    body: [
      charge.studio_name,
      `${charge.piece_title}`,
      `Firing ${charge.firing}`,
      `Fee $${formatDollars(charge.fee_cents)}`,
      fundingLine,
      `Balance after ${signedDollarLabel(balanceAfter)}`,
    ].join('\n'),
  };
}

type SettleOutcome = 'settled' | 'pending' | 'skipped';

/**
 * Settles one pending charge: one Kill Bill purchase, one ledger pair and one receipt,
 * with the funding stored on the charge the first time a purchase call is sent.
 */
export async function settleCharge(
  chargeId: string,
  budgetMs: number,
  held = false,
): Promise<SettleOutcome> {
  const charge = await claimCharge(chargeId, held);
  if (!charge) return 'skipped';
  try {
    const account = await ensureBillingAccount(
      {
        id: charge.member_id,
        studio_id: charge.studio_id,
        name: charge.member_name,
        email: charge.member_email,
        card_status: charge.card_status,
      },
      budgetMs,
    );
    const transactionKey = chargeTransactionKey(charge);
    const existing = kb.successfulTransaction(
      await kb.findPayment(transactionKey, budgetMs),
      transactionKey,
      'PURCHASE',
    );
    let funding = charge.funding;
    if (!existing) {
      if (funding === null) {
        funding = await transaction(async (client) => {
          await lockAll(client, [memberMoneyLock(charge.member_id)]);
          const balance = await currentBalance(client, charge.member_id);
          const chosen = chooseFunding(balance, charge.fee_cents, charge.card_status);
          await client.query('update charges set funding = $2, last_call_at = $3 where id = $1', [
            charge.id,
            chosen,
            now(),
          ]);
          return chosen;
        });
      } else {
        await pool.query('update charges set last_call_at = $2 where id = $1', [charge.id, now()]);
      }
      await kb.createPurchase(
        account.accountId,
        funding === 'card' ? account.card : account.credit,
        charge.fee_cents,
        transactionKey,
        budgetMs,
      );
    }
    if (funding === null) funding = 'credit';

    const posted = await transaction(async (client) => {
      await lockAll(client, [memberMoneyLock(charge.member_id)]);
      const fresh = await first<{ status: string; funding: Funding | null }>(
        client,
        'select status, funding from charges where id = $1 for update',
        [charge.id],
      );
      if (!fresh || fresh.status !== 'pending') return false;
      const settledFunding = fresh.funding ?? (funding as Funding);
      await postPair(
        client,
        charge.studio_id,
        charge.member_id,
        charge.firing === 'storage' ? 'storage_fee' : 'firing_fee',
        charge.id,
        feePair(settledFunding, charge.fee_cents),
      );
      await client.query(
        `update charges set status = 'settled', settled_at = $2, funding = $3, claimed_until = null
          where id = $1`,
        [charge.id, now(), settledFunding],
      );
      const balanceAfter = await currentBalance(client, charge.member_id);
      const mail = receiptEmail(charge, settledFunding, balanceAfter);
      await queueEmail(client, charge.studio_id, charge.member_email, mail.subject, mail.body);
      await publish(client, {
        kind: 'charge',
        id: charge.id,
        studio_id: charge.studio_id,
        member_id: charge.member_id,
      });
      await publish(client, {
        kind: 'credit',
        id: charge.member_id,
        studio_id: charge.studio_id,
        member_id: charge.member_id,
      });
      await publish(client, {
        kind: 'piece',
        id: charge.piece_id,
        studio_id: charge.studio_id,
        member_id: charge.member_id,
      });
      return true;
    });
    if (!posted) await releaseCharge(charge.id);
    return 'settled';
  } catch (error) {
    await releaseCharge(charge.id);
    if (error instanceof BillingTimeout || error instanceof BillingUnavailable) return 'pending';
    throw error;
  }
}

interface RefundResult {
  readonly status: 'refunded' | 'refund_pending';
}

/** Marks a refund whose call got no answer in time, so the settler finishes it. */
async function holdRefund(chargeId: string): Promise<RefundResult> {
  await pool.query(
    `update charges set status = 'refund_pending' where id = $1 and status = 'settled'`,
    [chargeId],
  );
  const charge = await first<{ studio_id: string; member_id: string; piece_id: string }>(
    pool,
    'select studio_id, member_id, piece_id from charges where id = $1',
    [chargeId],
  );
  if (charge) {
    await publish(pool, {
      kind: 'charge',
      id: chargeId,
      studio_id: charge.studio_id,
      member_id: charge.member_id,
    });
  }
  return { status: 'refund_pending' };
}

interface RefundTargetRow extends SettleTargetRow {
  readonly status: string;
  readonly refund_last_call_at: Date | null;
}

export async function refundCharge(
  chargeId: string,
  budgetMs: number,
  fromRequest: boolean,
): Promise<RefundResult | null> {
  const charge = await first<RefundTargetRow>(
    pool,
    `select c.id, c.studio_id, c.member_id, c.piece_id, c.firing, c.storage_day, c.fee_cents,
            c.funding, c.status, c.refund_last_call_at, p.title as piece_title,
            m.name as member_name, m.email as member_email, m.card_status, s.name as studio_name
       from charges c
       join pieces p on p.id = c.piece_id
       join people m on m.id = c.member_id
       join studios s on s.id = c.studio_id
      where c.id = $1`,
    [chargeId],
  );
  if (!charge) return null;
  const funding: Funding = charge.funding ?? 'credit';
  const purchaseKey = chargeTransactionKey(charge);
  const refundKey = kb.refundTransactionKey(charge.id);
  if (fromRequest) {
    await pool.query('update charges set refund_last_call_at = $2 where id = $1', [
      charge.id,
      now(),
    ]);
  }
  let payment: kb.KbPayment | null;
  try {
    payment = await kb.findPayment(purchaseKey, budgetMs);
  } catch (error) {
    if (error instanceof BillingTimeout) return holdRefund(charge.id);
    throw error;
  }
  const already = kb.successfulTransaction(payment, refundKey, 'REFUND');
  if (!already) {
    if (!payment) throw new BillingUnavailable('billing holds no purchase for that charge');
    if (!fromRequest) {
      const last = charge.refund_last_call_at;
      if (last && now().getTime() - last.getTime() < kb.SETTLER_BUDGET_MS) {
        return { status: 'refund_pending' };
      }
    }
    try {
      await kb.createRefund(payment.paymentId, charge.fee_cents, refundKey, budgetMs);
    } catch (error) {
      if (error instanceof BillingTimeout) return holdRefund(charge.id);
      throw error;
    }
  }
  await transaction(async (client) => {
    await lockAll(client, [memberMoneyLock(charge.member_id)]);
    const fresh = await first<{ status: string }>(
      client,
      'select status from charges where id = $1 for update',
      [charge.id],
    );
    if (!fresh || fresh.status === 'refunded') return;
    await postPair(
      client,
      charge.studio_id,
      charge.member_id,
      'refund',
      charge.id,
      refundPair(funding, charge.fee_cents),
    );
    await client.query(
      `update charges set status = 'refunded', refunded_at = $2 where id = $1`,
      [charge.id, now()],
    );
    await publish(client, {
      kind: 'charge',
      id: charge.id,
      studio_id: charge.studio_id,
      member_id: charge.member_id,
    });
    await publish(client, {
      kind: 'credit',
      id: charge.member_id,
      studio_id: charge.studio_id,
      member_id: charge.member_id,
    });
    await publish(client, {
      kind: 'piece',
      id: charge.piece_id,
      studio_id: charge.studio_id,
      member_id: charge.member_id,
    });
  });
  return { status: 'refunded' };
}
