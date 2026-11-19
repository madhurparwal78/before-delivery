import { now } from '../clock.js';
import { db, withTransaction } from '../db.js';
import { errors } from '../errors.js';
import { isoZoned } from '../domain/time.js';
import { topUp, walletBalance } from '../domain/ledger.js';
import { publishWallet } from '../actions/shared.js';
import type { Ctx, Reply, Router } from '../http.js';

async function walletBody(memberId: string): Promise<Record<string, unknown>> {
  const { rows } = await db.query<{
    id: string;
    entry_id: string;
    label: string;
    amount_cents: number;
    at: Date;
  }>(
    `select l.id, l.entry_id, l.label, l.amount_cents, e.at
       from ledger_lines l join ledger_entries e on e.id = l.entry_id
      where l.wallet_member_id = $1
      order by e.seq desc, l.seq desc`,
    [memberId],
  );
  return {
    balance_cents: await walletBalance(db, memberId),
    lines: rows.map((row) => ({
      id: row.id,
      entry_id: row.entry_id,
      label: row.label,
      amount_cents: row.amount_cents,
      at: isoZoned(row.at),
    })),
  };
}

async function get(ctx: Ctx): Promise<Reply> {
  return { status: 200, body: await walletBody(ctx.requireMember().id) };
}

async function addMoney(ctx: Ctx): Promise<Reply> {
  const member = ctx.requireMember();
  const body = ctx.json();
  const amount = typeof body.amount_cents === 'number' ? body.amount_cents : Number.NaN;
  if (
    !Number.isInteger(amount) ||
    amount % 500 !== 0 ||
    amount < 500 ||
    amount > 20_000
  ) {
    throw errors.validationFailed({
      amount_cents: 'Add between €5.00 and €200.00 in steps of €5.00.',
    });
  }
  await withTransaction((tx) => topUp(tx, now(), member.id, amount));
  await publishWallet(member.id);
  return { status: 201, body: await walletBody(member.id) };
}

export function registerWalletRoutes(router: Router): void {
  router.add({
    method: 'GET',
    pattern: '/api/wallet',
    kind: 'plain',
    auth: 'member',
    handler: get,
  });
  router.add({
    method: 'POST',
    pattern: '/api/wallet/top-ups',
    kind: 'json',
    auth: 'member',
    handler: addMoney,
  });
}
