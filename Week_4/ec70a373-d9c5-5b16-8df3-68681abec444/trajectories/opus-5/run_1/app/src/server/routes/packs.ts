import { randomUUID } from 'node:crypto';
import { iso, nowMs } from '../clock';
import { pool, query, tx } from '../db';
import { ApiError, isUuid } from '../http/errors';
import { closedBody } from '../http/request';
import type { HandlerResult, RequestContext } from '../http/context';
import { requireIdempotencyKey, withIdempotency } from '../domain/idempotency';
import { memberByUser, type MemberRecord } from '../domain/members';
import { sweepMemberExpiry } from '../domain/expiry';
import { sweepExpiredHolds } from '../domain/bookings';
import {
  balancesJson,
  createLot,
  recordMovement,
  withMemberLock,
} from '../domain/ledger';
import { queuePackReceipt } from '../domain/mail';
import {
  BillingUnavailable,
  ensureAccount,
  purchasePack,
  refundPayment,
} from '../services/killbill';
import { addDays, localDateOf } from '../../shared/tz';
import type { LedgerAccount, MovementJson, MovementKind, Role } from '../../shared/types';

async function requireMember(ctx: RequestContext): Promise<MemberRecord> {
  const user = ctx.requireUser();
  const member = await memberByUser(user.user_id);
  if (member === null) throw new ApiError('forbidden');
  return member;
}

export async function getPacks(ctx: RequestContext): Promise<HandlerResult> {
  const user = ctx.requireUser();
  const packs = await query<{ id: string; name: string; quarters: number; price_cents: number }>(
    `select id, name, quarters, price_cents from packs where tenant_id = $1
      order by display_order asc`,
    [user.tenant_id],
  );
  return {
    status: 200,
    body: {
      packs: packs.map((pack) => ({
        id: pack.id,
        name: pack.name,
        hours: pack.quarters / 4,
        price_cents: pack.price_cents,
      })),
    },
  };
}

export async function postPackPurchase(ctx: RequestContext): Promise<HandlerResult> {
  const member = await requireMember(ctx);
  const key = requireIdempotencyKey(ctx.headers['idempotency-key']);
  const body = ctx.json();
  const rawPackId = body.pack_id;
  if (typeof rawPackId !== 'string' || !isUuid(rawPackId)) throw new ApiError('not_found');
  const packs = await query<{ id: string; name: string; quarters: number; price_cents: number }>(
    'select id, name, quarters, price_cents from packs where id = $1 and tenant_id = $2',
    [rawPackId, member.tenant_id],
  );
  const pack = packs[0];
  if (pack === undefined) throw new ApiError('not_found');
  return withIdempotency(
    {
      actorUserId: member.user_id,
      key,
      method: 'POST',
      path: '/api/pack-purchases',
      binding: JSON.stringify({ pack_id: rawPackId }),
    },
    async () => {
      closedBody(body, ['pack_id']);
      await sweepMemberExpiry(member);
      const purchaseId = randomUUID();
      const accountId = await ensureAccount({
        memberId: member.id,
        businessName: member.business_name,
        email: member.email,
      });
      await query('update members set killbill_account_id = $2 where id = $1', [
        member.id,
        accountId,
      ]);
      const paymentId = await purchasePack({
        accountId,
        purchaseId,
        priceCents: pack.price_cents,
      });
      try {
        const outcome = await tx(async (client) => {
          return withMemberLock(client, member.id, async () => {
            const commitMs = nowMs();
            const validThrough = addDays(localDateOf(member.home_zone, commitMs), 60);
            await client.query(
              `insert into pack_purchases (id, tenant_id, member_id, pack_id, pack_name, quarters,
                 price_cents, valid_through, killbill_payment_id, created_at)
               values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
              [
                purchaseId,
                member.tenant_id,
                member.id,
                pack.id,
                pack.name,
                pack.quarters,
                pack.price_cents,
                validThrough,
                paymentId,
                iso(commitMs),
              ],
            );
            const lotId = await createLot(client, {
              memberId: member.id,
              purchaseId,
              packName: pack.name,
              validThrough,
              createdAtMs: commitMs,
            });
            await recordMovement(client, {
              tenantId: member.tenant_id,
              memberId: member.id,
              kind: 'pack_purchase',
              quarters: pack.quarters,
              createdAtMs: commitMs,
              actor: { userId: member.user_id, name: member.name, role: 'member' },
              purchaseId,
              lots: [{ lotId, quarters: pack.quarters }],
            });
            const balances = await balancesJson(client, member, commitMs);
            await queuePackReceipt(client, {
              purchaseId,
              memberEmail: member.email,
              packName: pack.name,
              quarters: pack.quarters,
              priceCents: pack.price_cents,
              validThrough,
              availableQuartersAfter: Math.round(balances.available_hours * 4),
            });
            return { validThrough, balances, createdAtMs: commitMs };
          });
        });
        ctx.audit.targetType = 'purchase';
        ctx.audit.targetId = purchaseId;
        return {
          status: 201,
          body: {
            purchase: {
              id: purchaseId,
              pack_id: pack.id,
              pack_name: pack.name,
              hours: pack.quarters / 4,
              price_cents: pack.price_cents,
              valid_through: outcome.validThrough,
              killbill_payment_id: paymentId,
              created_at: iso(outcome.createdAtMs),
            },
            balances: outcome.balances,
          },
        };
      } catch (error) {
        await refundPayment(paymentId, pack.price_cents);
        throw error;
      }
    },
  ).catch((error: unknown) => {
    if (error instanceof BillingUnavailable) throw new ApiError('billing_unavailable');
    throw error;
  });
}

interface MovementRow {
  id: string;
  kind: MovementKind;
  booking_id: string | null;
  purchase_id: string | null;
  quarters: number;
  created_at: Date;
  actor_user_id: string | null;
  actor_name: string | null;
  actor_role: Role | null;
}

export async function getLedger(ctx: RequestContext): Promise<HandlerResult> {
  const member = await requireMember(ctx);
  await sweepExpiredHolds();
  await sweepMemberExpiry(member);
  const movements = await query<MovementRow>(
    `select id, kind, booking_id, purchase_id, quarters, created_at,
            actor_user_id, actor_name, actor_role
       from movements where member_id = $1 order by seq desc`,
    [member.id],
  );
  const ids = movements.map((movement) => movement.id);
  const entries = await query<{ movement_id: string; account: LedgerAccount; quarters: number; position: number }>(
    `select movement_id, account, quarters, position from movement_entries
      where movement_id = any($1::uuid[]) order by position asc`,
    [ids],
  );
  const lots = await query<{ movement_id: string; purchase_id: string | null; quarters: number; position: number }>(
    `select ml.movement_id, l.purchase_id, ml.quarters, ml.position
       from movement_lots ml join lots l on l.id = ml.lot_id
      where ml.movement_id = any($1::uuid[]) order by ml.position asc`,
    [ids],
  );
  const json: MovementJson[] = movements.map((movement) => ({
    id: movement.id,
    kind: movement.kind,
    booking_id: movement.booking_id,
    purchase_id: movement.purchase_id,
    hours: movement.quarters / 4,
    created_at: iso(movement.created_at),
    actor:
      movement.actor_user_id === null || movement.actor_name === null || movement.actor_role === null
        ? null
        : {
            user_id: movement.actor_user_id,
            name: movement.actor_name,
            role: movement.actor_role,
          },
    lots: lots
      .filter((lot) => lot.movement_id === movement.id)
      .map((lot) => ({ purchase_id: lot.purchase_id, hours: lot.quarters / 4 })),
    entries: entries
      .filter((entry) => entry.movement_id === movement.id)
      .map((entry) => ({ account: entry.account, hours: entry.quarters / 4 })),
  }));
  const balances = await balancesJson(pool, member, nowMs());
  return { status: 200, body: { balances, movements: json } };
}
