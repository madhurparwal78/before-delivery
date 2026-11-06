import { now } from './clock.ts';
import { first, lockAll, pool, rows, transaction } from './db/pool.ts';
import { startOfNextStudioDay, studioDate } from './domain/studio-day.ts';
import { publish } from './events.ts';
import { ApiError } from './http/errors.ts';
import {
  currentBalance,
  ensureBillingAccount,
  memberMoneyLock,
  packPair,
  postPair,
} from './money.ts';
import { newId } from './security.ts';
import * as kb from './services/killbill.ts';
import { BillingTimeout, BillingUnavailable } from './services/killbill.ts';
import type { CardStatus } from './domain/funding.ts';

const DAILY_PACK_LIMIT = 3;

export interface PurchaseRow {
  readonly id: string;
  readonly studio_id: string;
  readonly member_id: string;
  readonly pack_id: string;
  readonly amount_cents: number;
  readonly idem_key: string;
  readonly status: 'held' | 'pending' | 'completed' | 'released';
  readonly studio_day: string;
  readonly created_at: Date;
  readonly last_call_at: Date | null;
}

export function purchaseBody(row: PurchaseRow): Record<string, unknown> {
  return {
    id: row.id,
    pack_id: row.pack_id,
    amount_cents: row.amount_cents,
    created_at: row.created_at.toISOString(),
    status: row.status === 'completed' ? 'completed' : 'pending',
  };
}

interface StartArgs {
  readonly studioId: string;
  readonly timeZone: string;
  readonly memberId: string;
  readonly packId: string;
  readonly amountCents: number;
  readonly idemKey: string;
}

/** Takes a place in the day's allowance, or hands back the attempt this key already owns. */
async function startAttempt(args: StartArgs): Promise<PurchaseRow> {
  return transaction(async (client) => {
    await lockAll(client, [memberMoneyLock(args.memberId)]);
    const member = await first<{ active: boolean; card_status: CardStatus }>(
      client,
      'select active, card_status from people where id = $1',
      [args.memberId],
    );
    if (!member || !member.active) throw new ApiError('member_inactive');
    if (member.card_status !== 'on_file') throw new ApiError('no_card_on_file');

    const today = studioDate(now(), args.timeZone);
    const existing = await first<PurchaseRow>(
      client,
      `select id, studio_id, member_id, pack_id, amount_cents, idem_key, status, studio_day,
              created_at, last_call_at
         from pack_purchases where studio_id = $1 and idem_key = $2 for update`,
      [args.studioId, args.idemKey],
    );
    if (existing && existing.status !== 'released') return existing;

    const used = await rows<{ taken: number }>(
      client,
      `select count(*)::bigint as taken from pack_purchases
        where member_id = $1 and studio_day = $2 and status in ('held','pending','completed')`,
      [args.memberId, today],
    );
    if ((used[0]?.taken ?? 0) >= DAILY_PACK_LIMIT) {
      throw new ApiError(
        'pack_limit_reached',
        'You can buy at most 3 credit packs a day. Try again after midnight studio time.',
        undefined,
        { next_purchase_at: startOfNextStudioDay(today, args.timeZone).toISOString() },
      );
    }

    if (existing) {
      const revived = await first<PurchaseRow>(
        client,
        `update pack_purchases set status = 'held', studio_day = $2 where id = $1
         returning id, studio_id, member_id, pack_id, amount_cents, idem_key, status, studio_day,
                   created_at, last_call_at`,
        [existing.id, today],
      );
      return revived as PurchaseRow;
    }
    const created = await first<PurchaseRow>(
      client,
      `insert into pack_purchases (id, studio_id, member_id, pack_id, amount_cents, idem_key,
                                   status, studio_day, created_at)
       values ($1,$2,$3,$4,$5,$6,'held',$7,$8)
       returning id, studio_id, member_id, pack_id, amount_cents, idem_key, status, studio_day,
                 created_at, last_call_at`,
      [
        newId(),
        args.studioId,
        args.memberId,
        args.packId,
        args.amountCents,
        args.idemKey,
        today,
        now(),
      ],
    );
    return created as PurchaseRow;
  });
}

async function completePurchase(purchase: PurchaseRow): Promise<void> {
  await transaction(async (client) => {
    await lockAll(client, [memberMoneyLock(purchase.member_id)]);
    const fresh = await first<{ status: string }>(
      client,
      'select status from pack_purchases where id = $1 for update',
      [purchase.id],
    );
    if (!fresh || fresh.status === 'completed') return;
    await postPair(
      client,
      purchase.studio_id,
      purchase.member_id,
      'pack',
      null,
      packPair(purchase.amount_cents),
    );
    await client.query(
      `update pack_purchases set status = 'completed', completed_at = $2, claimed_until = null
        where id = $1`,
      [purchase.id, now()],
    );
    await publish(client, {
      kind: 'credit',
      id: purchase.member_id,
      studio_id: purchase.studio_id,
      member_id: purchase.member_id,
    });
  });
}

interface MemberContact {
  readonly id: string;
  readonly studio_id: string;
  readonly name: string;
  readonly email: string;
  readonly card_status: CardStatus;
}

async function memberContact(memberId: string): Promise<MemberContact> {
  const row = await first<MemberContact>(
    pool,
    'select id, studio_id, name, email, card_status from people where id = $1',
    [memberId],
  );
  if (!row) throw new ApiError('member_inactive');
  return row;
}

/** Adopts the purchase Kill Bill already holds, otherwise sends it under the attempt's key. */
async function sendPurchase(purchase: PurchaseRow, budgetMs: number): Promise<void> {
  const member = await memberContact(purchase.member_id);
  const account = await ensureBillingAccount(member, budgetMs);
  const transactionKey = kb.packTransactionKey(purchase.id);
  const existing = kb.successfulTransaction(
    await kb.findPayment(transactionKey, budgetMs),
    transactionKey,
    'PURCHASE',
  );
  if (!existing) {
    await kb.createPurchase(
      account.accountId,
      account.card,
      purchase.amount_cents,
      transactionKey,
      budgetMs,
    );
  }
  await completePurchase(purchase);
}

interface PurchaseOutcome {
  readonly status: 201 | 202;
  readonly purchase: PurchaseRow;
  readonly balanceCents: number;
}

export async function buyPack(args: StartArgs): Promise<PurchaseOutcome> {
  const attempt = await startAttempt(args);
  if (attempt.status === 'completed') {
    return {
      status: 201,
      purchase: attempt,
      balanceCents: await currentBalance(pool, args.memberId),
    };
  }
  if (attempt.status === 'pending') {
    return {
      status: 202,
      purchase: attempt,
      balanceCents: await currentBalance(pool, args.memberId),
    };
  }
  await pool.query('update pack_purchases set last_call_at = $2 where id = $1', [
    attempt.id,
    now(),
  ]);
  try {
    await sendPurchase(attempt, kb.REQUEST_BUDGET_MS);
    const fresh = (await first<PurchaseRow>(
      pool,
      `select id, studio_id, member_id, pack_id, amount_cents, idem_key, status, studio_day,
              created_at, last_call_at from pack_purchases where id = $1`,
      [attempt.id],
    )) as PurchaseRow;
    return {
      status: 201,
      purchase: fresh,
      balanceCents: await currentBalance(pool, args.memberId),
    };
  } catch (error) {
    if (error instanceof BillingTimeout) {
      await pool.query(`update pack_purchases set status = 'pending' where id = $1`, [attempt.id]);
      const pending = (await first<PurchaseRow>(
        pool,
        `select id, studio_id, member_id, pack_id, amount_cents, idem_key, status, studio_day,
                created_at, last_call_at from pack_purchases where id = $1`,
        [attempt.id],
      )) as PurchaseRow;
      return {
        status: 202,
        purchase: pending,
        balanceCents: await currentBalance(pool, args.memberId),
      };
    }
    if (error instanceof BillingUnavailable) throw new ApiError('billing_unavailable');
    throw error;
  }
}

/**
 * The settler's share of pack work: adopt the purchase Kill Bill holds, make a timed-out
 * purchase under its own key, or free the place a never-sent attempt is holding.
 */
export async function settleOpenAttempt(purchase: PurchaseRow): Promise<void> {
  const transactionKey = kb.packTransactionKey(purchase.id);
  const existing = kb.successfulTransaction(
    await kb.findPayment(transactionKey, kb.SETTLER_BUDGET_MS),
    transactionKey,
    'PURCHASE',
  );
  if (existing) {
    await completePurchase(purchase);
    return;
  }
  const last = purchase.last_call_at;
  if (last && now().getTime() - last.getTime() < kb.SETTLER_BUDGET_MS) return;
  if (purchase.status === 'held') {
    await pool.query(
      `update pack_purchases set status = 'released' where id = $1 and status = 'held'`,
      [purchase.id],
    );
    return;
  }
  const member = await memberContact(purchase.member_id);
  const account = await ensureBillingAccount(member, kb.SETTLER_BUDGET_MS);
  await kb.createPurchase(
    account.accountId,
    account.card,
    purchase.amount_cents,
    transactionKey,
    kb.SETTLER_BUDGET_MS,
  );
  await completePurchase(purchase);
}
