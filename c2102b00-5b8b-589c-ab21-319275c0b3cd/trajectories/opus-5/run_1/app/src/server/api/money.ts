import { db, writeTx } from '../db.ts';
import { conflict, forbidden, notFound, paymentsPaused, validation } from '../http/errors.ts';
import { param, requireRole, viewerOf, type ApiResult, type RequestContext } from '../http/context.ts';
import { jsonBody } from '../http/context.ts';
import { MAX_TOPUP_CENTS, MIN_TOPUP_CENTS, parseDollarsToCents, topupAmountInRange } from '../domain/amount.ts';
import { decodeCursor, encodeCursor } from '../domain/ledgerOrder.ts';
import { householdAccount } from '../domain/credit.ts';
import { toIsoSeconds } from '../domain/clubTime.ts';
import { formatDollars } from '../../shared/money.ts';
import {
  countMovementsForAccount,
  creditFor,
  getHousehold,
  movementsForAccount,
} from '../store.ts';
import * as killbill from '../providers/killbill.ts';
import { PaymentsUnavailableError } from '../providers/killbill.ts';
import { notePaymentsOutage } from './identity.ts';

const AMOUNT_COPY = `Enter an amount from $${formatDollars(MIN_TOPUP_CENTS)} to $${formatDollars(MAX_TOPUP_CENTS)}.`;

interface TopupRow {
  id: number;
  amount_cents: number;
  status: string;
  created_at: string;
}

export async function postTopup(ctx: RequestContext): Promise<ApiResult> {
  const viewer = requireRole(ctx, ['member']);
  const householdCode = viewer.householdCode!;
  const body = jsonBody(ctx);
  const amountText = body.amount;
  if (typeof amountText !== 'string') throw validation({ amount: AMOUNT_COPY });
  const cents = parseDollarsToCents(amountText);
  if (cents === null || !topupAmountInRange(cents)) throw validation({ amount: AMOUNT_COPY });

  const header = ctx.headers['idempotency-key'];
  const idempotencyKey = (Array.isArray(header) ? header[0] : header)!;
  const paymentKey = killbill.topupPaymentKey(householdCode, idempotencyKey);
  const household = getHousehold(householdCode)!;

  try {
    const accountId = await killbill.ensureAccount(household);
    const existing = await killbill.findTopupPayment(paymentKey);
    if (existing) {
      if (existing.amountCents !== cents) {
        throw conflict('idempotency_key_reused', 'That top-up was already sent with a different amount.');
      }
      if (!existing.succeeded) throw paymentsPaused();
    } else {
      const succeeded = await killbill.createTopupPayment(accountId, paymentKey, cents);
      if (!succeeded) throw paymentsPaused();
    }
    notePaymentsOutage(true);
  } catch (error) {
    if (error instanceof PaymentsUnavailableError) {
      notePaymentsOutage(false);
      throw paymentsPaused();
    }
    throw error;
  }

  return writeTx(() => {
    const stored = db.prepare('SELECT id, amount_cents, status, created_at FROM topups WHERE payment_key = ?').get(
      paymentKey,
    ) as TopupRow | undefined;
    let topup = stored;
    if (!topup) {
      const createdAt = toIsoSeconds(new Date(ctx.now));
      const info = db
        .prepare(
          "INSERT INTO topups (household_code, amount_cents, status, created_at, payment_key) VALUES (?, ?, 'confirmed', ?, ?)",
        )
        .run(householdCode, cents, createdAt, paymentKey);
      const movement = db
        .prepare("INSERT INTO movements (kind, cycle_id, memo, created_at) VALUES ('top_up', NULL, 'Top-up', ?)")
        .run(createdAt);
      const movementId = Number(movement.lastInsertRowid);
      const leg = db.prepare('INSERT INTO legs (movement_id, account, amount_cents) VALUES (?, ?, ?)');
      leg.run(movementId, householdAccount(householdCode), cents);
      leg.run(movementId, 'clearing:killbill', -cents);
      topup = {
        id: Number(info.lastInsertRowid),
        amount_cents: cents,
        status: 'confirmed',
        created_at: createdAt,
      };
    }
    return {
      status: 201,
      body: {
        topup: {
          id: topup.id,
          amount_cents: topup.amount_cents,
          status: 'confirmed',
          created_at: topup.created_at,
        },
        credit: creditFor(householdCode),
      },
    };
  });
}

export function listTopups(ctx: RequestContext): ApiResult {
  const viewer = requireRole(ctx, ['member']);
  const rows = db
    .prepare(
      "SELECT id, amount_cents, status, created_at FROM topups WHERE household_code = ? ORDER BY id DESC",
    )
    .all(viewer.householdCode!);
  return { status: 200, body: { topups: rows } };
}

export function getLedger(ctx: RequestContext): ApiResult {
  const viewer = viewerOf(ctx);
  const code = param(ctx, 'householdCode');
  const household = getHousehold(code);
  if (!household) throw notFound();
  if (viewer.role === 'volunteer') throw forbidden();
  if (viewer.role === 'member' && viewer.householdCode !== code) throw forbidden();

  const fields: Record<string, string> = {};
  const limitText = ctx.url.searchParams.get('limit');
  let limit = 20;
  if (limitText !== null) {
    if (!/^\d+$/.test(limitText) || Number(limitText) < 1 || Number(limitText) > 50) {
      fields.limit = 'Use a whole number from 1 to 50.';
    } else {
      limit = Number(limitText);
    }
  }
  const beforeText = ctx.url.searchParams.get('before');
  let before = null;
  if (beforeText !== null) {
    const cursor = decodeCursor(beforeText);
    if (!cursor) fields.before = 'That page marker is not one we issued.';
    else before = { createdAt: cursor.createdAt, id: cursor.id };
  }
  if (Object.keys(fields).length > 0) throw validation(fields);

  const account = householdAccount(code);
  const rows = movementsForAccount(account, limit + 1, before);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const credit = creditFor(code);
  return {
    status: 200,
    body: {
      household_code: code,
      balance_cents: credit.balance_cents,
      held_cents: credit.held_cents,
      spendable_cents: credit.spendable_cents,
      total_movements: countMovementsForAccount(account),
      next_before: rows.length > limit && last ? encodeCursor({ createdAt: last.created_at, id: last.id }) : null,
      movements: page,
    },
  };
}
