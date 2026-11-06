import { databaseIsUp } from '../db.js';
import { fail, notFound } from '../http/errors.js';
import { checkFields, FieldErrors } from '../http/validate.js';
import { operatorRoute, type Route } from '../http/route.js';
import { mailIsUp, queuedMailCount } from '../mail/queue.js';
import { RESOURCES } from '../../shared/types.js';
import { applyLapsedRaids, deploysOf, loadRaid, simulateRaid } from '../domain/raids.js';
import { loadIsland, storageCaps } from '../domain/village.js';
import { resourcesOf } from '../domain/ledger.js';

export const opsRoutes: Route[] = [
  operatorRoute('GET', '/api/ops/status', async () => ({
    status: 200,
    body: {
      database: databaseIsUp() ? 'up' : 'down',
      mail: mailIsUp() ? 'up' : 'down',
      queuedMail: await queuedMailCount()
    }
  })),

  operatorRoute('POST', '/api/ops/raids/:id/rerun', async (ctx, client) => {
    const errors = new FieldErrors();
    checkFields(ctx.body, [], [], errors);
    errors.throwIfAny();
    await applyLapsedRaids(client, ctx.now);
    const raid = await loadRaid(client, Number(ctx.params.id));
    if (raid === null) notFound();
    if (raid.state !== 'resolved' || raid.result === null || raid.tickHashes === null) {
      fail('raid_not_resolved');
    }
    const deploys = await deploysOf(client, raid.id);
    const rerun = simulateRaid(raid, deploys);
    const stored = raid.tickHashes;
    let firstMismatchTick: number | null = null;
    const length = Math.max(stored.length, rerun.ticks.length);
    for (let tick = 0; tick < length; tick += 1) {
      if (stored[tick] !== rerun.ticks[tick]?.hash) {
        firstMismatchTick = tick;
        break;
      }
    }
    return {
      status: 200,
      body: {
        raidId: raid.id,
        seed: raid.seed,
        finalTick: rerun.finalTick,
        match: firstMismatchTick === null,
        firstMismatchTick,
        result: raid.result
      }
    };
  }),

  operatorRoute('GET', '/api/ops/ledger/check', async (ctx, client) => {
    const { rows: pairRows } = await client.query<{ pairs: number; unbalanced: number }>(
      `SELECT COUNT(*)::int AS pairs,
              COUNT(*) FILTER (WHERE total <> 0)::int AS unbalanced
         FROM (
           SELECT pair_id, SUM(amount) AS total FROM ledger_entries GROUP BY pair_id
         ) pairs`
    );
    const { rows: villages } = await client.query<{ id: number }>('SELECT id FROM villages');
    let overCap = 0;
    for (const village of villages) {
      const island = await loadIsland(client, Number(village.id), ctx.now);
      if (island === null) continue;
      const caps = storageCaps(island);
      const balances = resourcesOf(island.balances);
      for (const resource of RESOURCES) {
        if (balances[resource] > caps[resource]) overCap += 1;
      }
    }
    return {
      status: 200,
      body: {
        pairs: Number(pairRows[0]?.pairs ?? 0),
        unbalancedPairs: Number(pairRows[0]?.unbalanced ?? 0),
        overCap
      }
    };
  })
];
