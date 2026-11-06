import { endEverySession } from '../auth.ts';
import { now } from '../clock.ts';
import { first, lockAll, pool, rows, transaction } from '../db/pool.ts';
import { publish } from '../events.ts';
import { ApiError, ValidationBag } from '../http/errors.ts';
import { V } from '../http/messages.ts';
import { safeParam } from '../http/pipeline.ts';
import {
  adjustmentPair,
  currentBalance,
  memberMoneyLock,
  postPair,
  refundCharge,
} from '../money.ts';
import { isUuid } from '../security.ts';
import { BillingUnavailable, REQUEST_BUDGET_MS } from '../services/killbill.ts';
import { chargeBody, CHARGE_COLUMNS, ledgerEntries, memberCharges, type ChargeRow } from '../views.ts';
import type { Route, RouteResult } from '../http/context.ts';
import { Ctx } from '../http/context.ts';

interface MemberListRow {
  readonly id: string;
  readonly name: string;
  readonly handle: string;
  readonly email: string;
  readonly membership: 'member' | 'drop_off';
  readonly card_status: 'none' | 'on_file';
  readonly active: boolean;
  readonly balance_cents: number;
}

const MEMBER_SELECT = `select p.id, p.name, p.handle, p.email, p.membership, p.card_status, p.active,
   coalesce((select sum(e.amount_cents) from ledger_entries e
              where e.member_id = p.id and e.account = 'member_credit'), 0)::bigint as balance_cents
   from people p`;

async function listMembers(ctx: Ctx): Promise<RouteResult> {
  const actor = ctx.actorOrFail;
  const q = (ctx.query.get('q') ?? '').trim();
  const params: unknown[] = [actor.studio.id];
  let filter = '';
  if (q !== '') {
    params.push(`%${q}%`);
    filter = ` and (p.name ilike $2 or p.handle ilike $2 or p.email ilike $2)`;
  }
  const found = await rows<MemberListRow>(
    pool,
    `${MEMBER_SELECT} where p.studio_id = $1 and p.role = 'member'${filter} order by p.name`,
    params,
  );
  return { status: 200, body: found };
}

async function resolveMember(ctx: Ctx): Promise<void> {
  const id = safeParam(ctx, 'id');
  if (!isUuid(id)) throw new ApiError('not_found');
  const member = await first<MemberListRow>(
    pool,
    `${MEMBER_SELECT} where p.id = $1 and p.studio_id = $2 and p.role = 'member'`,
    [id, ctx.actorOrFail.studio.id],
  );
  if (!member) throw new ApiError('not_found');
  ctx.store['member'] = member;
}

function heldMember(ctx: Ctx): MemberListRow {
  return ctx.store['member'] as MemberListRow;
}

async function memberObject(studioId: string, memberId: string): Promise<MemberListRow> {
  return (await first<MemberListRow>(
    pool,
    `${MEMBER_SELECT} where p.id = $1 and p.studio_id = $2`,
    [memberId, studioId],
  )) as MemberListRow;
}

async function readMember(ctx: Ctx): Promise<RouteResult> {
  const actor = ctx.actorOrFail;
  const member = heldMember(ctx);
  return {
    status: 200,
    body: {
      ...(await memberObject(actor.studio.id, member.id)),
      entries: await ledgerEntries(pool, member.id),
      charges: await memberCharges(pool, member.id),
    },
  };
}

async function deactivate(ctx: Ctx): Promise<RouteResult> {
  const actor = ctx.actorOrFail;
  const member = heldMember(ctx);
  await transaction(async (client) => {
    await lockAll(client, [memberMoneyLock(member.id)]);
    const fresh = await first<{ active: boolean }>(
      client,
      'select active from people where id = $1 for update',
      [member.id],
    );
    if (!fresh || !fresh.active) return;
    await client.query('update people set active = false where id = $1', [member.id]);
    await endEverySession(client, actor.studio.id, member.id);
    await client.query(
      `update invites set retired_at = $3
        where studio_id = $1 and email_lower = (select email_lower from people where id = $2)
          and used_at is null and retired_at is null`,
      [actor.studio.id, member.id, now()],
    );
    await publish(client, {
      kind: 'session',
      id: member.id,
      studio_id: actor.studio.id,
      member_id: member.id,
    });
    await publish(client, { kind: 'member', id: member.id, studio_id: actor.studio.id });
  });
  return { status: 200, body: await memberObject(actor.studio.id, member.id) };
}

async function reactivate(ctx: Ctx): Promise<RouteResult> {
  const actor = ctx.actorOrFail;
  const member = heldMember(ctx);
  await transaction(async (client) => {
    await lockAll(client, [memberMoneyLock(member.id)]);
    await client.query('update people set active = true where id = $1', [member.id]);
    await publish(client, { kind: 'member', id: member.id, studio_id: actor.studio.id });
  });
  return { status: 200, body: await memberObject(actor.studio.id, member.id) };
}

async function postAdjustment(ctx: Ctx): Promise<RouteResult> {
  const actor = ctx.actorOrFail;
  const member = heldMember(ctx);
  const amount = ctx.json['amount_cents'];
  const reason = typeof ctx.json['reason'] === 'string' ? ctx.json['reason'].trim() : '';
  const bag = new ValidationBag();
  if (
    typeof amount !== 'number' ||
    !Number.isInteger(amount) ||
    amount === 0 ||
    amount < -100_000 ||
    amount > 100_000
  ) {
    bag.add('amount_cents', V.amountCents);
  }
  if (reason.length < 1 || reason.length > 200) bag.add('reason', V.reason);
  bag.throwIfAny();

  const outcome = await transaction(async (client) => {
    await lockAll(client, [memberMoneyLock(member.id)]);
    const movementId = await postPair(
      client,
      actor.studio.id,
      member.id,
      'adjustment',
      null,
      adjustmentPair(amount as number),
    );
    await publish(client, {
      kind: 'credit',
      id: member.id,
      studio_id: actor.studio.id,
      member_id: member.id,
    });
    await publish(client, { kind: 'member', id: member.id, studio_id: actor.studio.id });
    return { movementId, balance: await currentBalance(client, member.id) };
  });
  return {
    status: 201,
    body: { movement_id: outcome.movementId, balance_cents: outcome.balance },
  };
}

async function resolveCharge(ctx: Ctx): Promise<void> {
  const id = safeParam(ctx, 'id');
  if (!isUuid(id)) throw new ApiError('not_found');
  const charge = await first<{ id: string; member_id: string; status: string }>(
    pool,
    'select id, member_id, status from charges where id = $1 and studio_id = $2',
    [id, ctx.actorOrFail.studio.id],
  );
  if (!charge) throw new ApiError('not_found');
  ctx.store['charge'] = charge;
}

async function refund(ctx: Ctx): Promise<RouteResult> {
  const actor = ctx.actorOrFail;
  const charge = ctx.store['charge'] as { id: string; member_id: string; status: string };
  if (charge.status !== 'settled') throw new ApiError('charge_not_refundable');
  const reason = typeof ctx.json['reason'] === 'string' ? ctx.json['reason'].trim() : '';
  const bag = new ValidationBag();
  if (reason.length < 1 || reason.length > 200) bag.add('reason', V.reason);
  bag.throwIfAny();
  await pool.query('update charges set refund_reason = $2 where id = $1', [charge.id, reason]);

  let pending = false;
  try {
    const outcome = await refundCharge(charge.id, REQUEST_BUDGET_MS, true);
    pending = outcome?.status === 'refund_pending';
  } catch (error) {
    if (error instanceof BillingUnavailable) throw new ApiError('billing_unavailable');
    throw error;
  }
  const fresh = (await first<ChargeRow>(
    pool,
    `select ${CHARGE_COLUMNS} from charges c join pieces pc on pc.id = c.piece_id where c.id = $1`,
    [charge.id],
  )) as ChargeRow;
  return {
    status: pending ? 202 : 200,
    body: {
      charge: chargeBody(fresh),
      balance_cents: await currentBalance(pool, charge.member_id),
    },
  };
}

export const memberRoutes: readonly Route[] = [
  { method: 'GET', pattern: '/api/members', role: 'owner', handle: listMembers },
  {
    method: 'GET',
    pattern: '/api/members/:id',
    role: 'owner',
    resolve: resolveMember,
    handle: readMember,
  },
  {
    method: 'POST',
    pattern: '/api/members/:id/deactivate',
    role: 'owner',
    resolve: resolveMember,
    handle: deactivate,
  },
  {
    method: 'POST',
    pattern: '/api/members/:id/reactivate',
    role: 'owner',
    resolve: resolveMember,
    handle: reactivate,
  },
  {
    method: 'POST',
    pattern: '/api/members/:id/adjustments',
    role: 'owner',
    resolve: resolveMember,
    handle: postAdjustment,
  },
  {
    method: 'POST',
    pattern: '/api/charges/:id/refund',
    role: 'owner',
    resolve: resolveCharge,
    handle: refund,
  },
];
