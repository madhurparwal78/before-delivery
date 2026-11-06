import { first, pool } from '../db/pool.ts';
import { ApiError } from '../http/errors.ts';
import { safeParam } from '../http/pipeline.ts';
import { buyPack, purchaseBody } from '../packs.ts';
import { isUuid } from '../security.ts';
import { balanceCents, ledgerEntries } from '../views.ts';
import type { CardStatus } from '../domain/funding.ts';
import type { Route, RouteResult } from '../http/context.ts';
import { Ctx } from '../http/context.ts';

interface PackRow {
  readonly id: string;
  readonly name: string;
  readonly amount_cents: number;
}

async function readCredit(ctx: Ctx): Promise<RouteResult> {
  const actor = ctx.actorOrFail;
  const person = (await first<{ card_status: CardStatus }>(
    pool,
    'select card_status from people where id = $1',
    [actor.personId],
  )) as { card_status: CardStatus };
  return {
    status: 200,
    body: {
      balance_cents: await balanceCents(pool, actor.personId),
      card_status: person.card_status,
      entries: await ledgerEntries(pool, actor.personId),
    },
  };
}

async function resolvePack(ctx: Ctx): Promise<void> {
  const id = safeParam(ctx, 'id');
  if (!isUuid(id)) throw new ApiError('not_found');
  const pack = await first<PackRow>(
    pool,
    'select id, name, amount_cents from credit_packs where id = $1 and studio_id = $2',
    [id, ctx.actorOrFail.studio.id],
  );
  if (!pack) throw new ApiError('not_found');
  ctx.store['pack'] = pack;
}

async function purchase(ctx: Ctx): Promise<RouteResult> {
  const actor = ctx.actorOrFail;
  const pack = ctx.store['pack'] as PackRow;
  const outcome = await buyPack({
    studioId: actor.studio.id,
    timeZone: actor.studio.time_zone,
    memberId: actor.personId,
    packId: pack.id,
    amountCents: pack.amount_cents,
    idemKey: ctx.header('idempotency-key'),
  });
  return {
    status: outcome.status,
    body: {
      purchase: purchaseBody(outcome.purchase),
      balance_cents: outcome.balanceCents,
    },
  };
}

export const creditRoutes: readonly Route[] = [
  { method: 'GET', pattern: '/api/me/credit', role: 'member', handle: readCredit },
  {
    method: 'POST',
    pattern: '/api/credit-packs/:id/purchase',
    role: 'member',
    idempotent: true,
    resolve: resolvePack,
    handle: purchase,
  },
];
