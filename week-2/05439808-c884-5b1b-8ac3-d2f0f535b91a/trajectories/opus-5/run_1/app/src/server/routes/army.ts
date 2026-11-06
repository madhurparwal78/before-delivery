import type { Queryable } from '../db.js';
import { takeLock } from '../db.js';
import { fail, notFound } from '../http/errors.js';
import { checkFields, FieldErrors } from '../http/validate.js';
import { FIELD_MESSAGES } from '../../shared/messages.js';
import { sessionRoute, type Route } from '../http/route.js';
import { trainingCost, UNITS } from '../../shared/catalog.js';
import { isUnitKey, type UnitKey } from '../../shared/types.js';
import { villageIdOf } from '../domain/accounts.js';
import { armyView } from '../domain/presenters.js';
import { applyLapsedRaids } from '../domain/raids.js';
import {
  canAfford,
  creditCapped,
  housingCapacity,
  housingUsed,
  loadIsland,
  spend,
  trainDuration,
  type Island
} from '../domain/village.js';

async function ownIsland(client: Queryable, accountId: number, at: Date): Promise<Island> {
  const villageId = await villageIdOf(client, accountId);
  if (villageId === null) notFound();
  await takeLock(client, 'village', villageId);
  await applyLapsedRaids(client, at);
  const island = await loadIsland(client, villageId, at);
  if (island === null) notFound();
  return island;
}

function barracksLevel(island: Island): number {
  return island.buildings
    .filter((building) => building.type === 'tide_barracks')
    .reduce((best, building) => Math.max(best, building.level), 0);
}

export const armyRoutes: Route[] = [
  sessionRoute('GET', '/api/army', async (ctx, client) => {
    const island = await ownIsland(client, ctx.account.id, ctx.now);
    return { status: 200, body: { army: armyView(island) } };
  }),

  sessionRoute('POST', '/api/army/train', async (ctx, client) => {
    const island = await ownIsland(client, ctx.account.id, ctx.now);
    const errors = new FieldErrors();
    checkFields(ctx.body, ['unit', 'count'], ['unit', 'count'], errors);
    const rawUnit = ctx.body.unit;
    const unit: UnitKey =
      typeof rawUnit === 'string' && isUnitKey(rawUnit) ? rawUnit : 'saltjack';
    if (!(typeof rawUnit === 'string' && isUnitKey(rawUnit)) && rawUnit !== undefined) {
      errors.add('unit', FIELD_MESSAGES.unit);
    }
    const rawCount = ctx.body.count;
    const count =
      typeof rawCount === 'number' && Number.isInteger(rawCount) && rawCount >= 1 && rawCount <= 20
        ? rawCount
        : null;
    if (count === null && rawCount !== undefined) {
      errors.add('count', FIELD_MESSAGES.trainingCount);
    }
    errors.throwIfAny();
    const batchCount = count ?? 1;

    const barracks = barracksLevel(island);
    if (barracks < 1) fail('barracks_required');
    if (barracks < UNITS[unit].barracksLevel) fail('barracks_level_too_low');
    if (housingUsed(island) + batchCount > housingCapacity(island)) fail('housing_full');
    const cost = trainingCost(unit, batchCount);
    if (!canAfford(island, cost)) fail('insufficient_resources');

    await spend(client, island, cost, 'train_spend');
    const last = island.training[island.training.length - 1];
    const startsAt = last ? last.finishesAt : ctx.now;
    const finishesAt = new Date(startsAt.getTime() + trainDuration(unit, batchCount) * 1000);
    await client.query(
      `INSERT INTO training_batches (village_id, unit, count, queued_at, starts_at, finishes_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        island.villageId,
        unit,
        batchCount,
        ctx.now.toISOString(),
        startsAt.toISOString(),
        finishesAt.toISOString()
      ]
    );
    const reloaded = await loadIsland(client, island.villageId, ctx.now);
    if (reloaded === null) notFound();
    return { status: 201, body: { army: armyView(reloaded) } };
  }),

  sessionRoute('POST', '/api/army/training/:batchId/cancel', async (ctx, client) => {
    const island = await ownIsland(client, ctx.account.id, ctx.now);
    const errors = new FieldErrors();
    checkFields(ctx.body, [], [], errors);
    errors.throwIfAny();
    const batchId = Number(ctx.params.batchId);
    const { rows } = await client.query<{
      id: number;
      unit: string;
      count: number;
      starts_at: Date;
      applied: boolean;
    }>(
      `SELECT id, unit, count, starts_at, applied FROM training_batches
        WHERE id = $1 AND village_id = $2 AND cancelled_at IS NULL`,
      [batchId, island.villageId]
    );
    const batch = rows[0];
    if (!batch) notFound();
    if (batch.applied) fail('batch_already_finished');

    const unit = batch.unit as UnitKey;
    const split = await creditCapped(
      client,
      island,
      trainingCost(unit, batch.count),
      'refund',
      ctx.now
    );
    await client.query('UPDATE training_batches SET cancelled_at = $2 WHERE id = $1', [
      batch.id,
      ctx.now.toISOString()
    ]);

    const hadStarted = batch.starts_at.getTime() <= ctx.now.getTime();
    let anchor = hadStarted ? ctx.now : batch.starts_at;
    const { rows: later } = await client.query<{
      id: number;
      unit: string;
      count: number;
      queued_at: Date;
    }>(
      `SELECT id, unit, count, queued_at FROM training_batches
        WHERE village_id = $1 AND cancelled_at IS NULL AND applied = false AND id > $2
        ORDER BY id`,
      [island.villageId, batch.id]
    );
    for (const next of later) {
      const startsAt = new Date(Math.max(anchor.getTime(), next.queued_at.getTime()));
      const finishesAt = new Date(
        startsAt.getTime() + trainDuration(next.unit as UnitKey, next.count) * 1000
      );
      await client.query(
        'UPDATE training_batches SET starts_at = $2, finishes_at = $3 WHERE id = $1',
        [next.id, startsAt.toISOString(), finishesAt.toISOString()]
      );
      anchor = finishesAt;
    }

    const reloaded = await loadIsland(client, island.villageId, ctx.now);
    if (reloaded === null) notFound();
    return {
      status: 200,
      body: { army: armyView(reloaded), refunded: split.credited, lost: split.lost }
    };
  })
];
