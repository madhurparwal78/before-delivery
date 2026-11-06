// Operations: service status, raid re-run and the ledger check. Operator only.
import { errors } from './errors.ts';
import { pathId, route } from './http.ts';
import { getApp, withTransaction } from './runtime.ts';
import { mapRaidRow, RAID_SELECT } from './api_raid.ts';
import { simulate } from '../sim/battle.ts';
import type { ResourceAmounts } from '../domain/types.ts';
import { storageCapsOf } from './island.ts';

route('GET', '/api/ops/status', 'operator', async () => {
  const app = getApp();
  const queued = await withTransaction((client) =>
    client.query<{ count: string }>('SELECT COUNT(*)::int AS count FROM mail_queue WHERE sent_at IS NULL')
  );
  return {
    status: 200,
    body: {
      database: app.dbUp ? 'up' : 'down',
      mail: app.mailUp ? 'up' : 'down',
      queuedMail: Number(queued.rows[0].count),
    },
  };
});

route('POST', '/api/ops/raids/:id/rerun', 'operator', async (ctx) => {
  const raidId = pathId(ctx, 'id');
  const body = ctx.body as Record<string, unknown>;
  if (body && typeof body === 'object' && Object.keys(body).length > 0) {
    const { exactFields, throwIfErrors } = await import('./validate.ts');
    throwIfErrors(exactFields(body, []));
  }
  const report = await withTransaction(async (client) => {
    const result = await client.query(`${RAID_SELECT} WHERE r.id = $1`, [raidId]);
    if (result.rows.length === 0) return 'missing' as const;
    const row = mapRaidRow(result.rows[0]);
    if (row.state !== 'resolved') return 'unresolved' as const;
    const lootable = row.result!.lootable as ResourceAmounts;
    const sim = simulate({ seed: row.seed, layout: row.layout, deploys: row.deploys, lootable });
    const hashes = sim.ticks.map((t) => t.hash);
    const stored = row.hashes ?? [];
    let firstMismatch: number | null = null;
    const limit = Math.max(hashes.length, stored.length);
    for (let i = 0; i < limit; i++) {
      if (hashes[i] !== stored[i]) {
        firstMismatch = i;
        break;
      }
    }
    return { row, hashes, firstMismatch };
  });
  if (report === 'missing') throw errors.notFound();
  if (report === 'unresolved') throw errors.conflict('raid_not_resolved', 'That raid has no result to re-run.');
  return {
    status: 200,
    body: {
      raidId,
      seed: report.row.seed,
      finalTick: report.row.final_tick,
      match: report.firstMismatch === null,
      firstMismatchTick: report.firstMismatch,
      result: report.row.result,
    },
  };
});

route('GET', '/api/ops/ledger/check', 'operator', async () => {
  const report = await withTransaction(async (client) => {
    const pairs = await client.query<{ count: string }>('SELECT COUNT(DISTINCT pair_id)::int AS count FROM ledger');
    const unbalanced = await client.query<{ count: string }>(
      'SELECT COUNT(*)::int AS count FROM (SELECT pair_id FROM ledger GROUP BY pair_id HAVING SUM(amount) <> 0) t'
    );
    const villages = await client.query<{ id: string }>('SELECT id FROM villages');
    let overCap = 0;
    for (const v of villages.rows) {
      const villageId = Number(v.id);
      const buildings = (await client.query(
        `SELECT type, level FROM buildings WHERE village_id = $1`,
        [villageId]
      )).rows.map((r) => ({ type: r.type as never, level: Number(r.level) }));
      const caps = storageCapsOf(buildings as never);
      const balances = await client.query<{ asset: string; total: string }>(
        'SELECT asset, SUM(amount)::bigint AS total FROM ledger WHERE village_id = $1 GROUP BY asset',
        [villageId]
      );
      for (const row of balances.rows) {
        const amount = Number(row.total);
        if ((row.asset === 'brine' || row.asset === 'peat' || row.asset === 'copper') && amount > caps[row.asset]) overCap++;
      }
    }
    return { pairs: Number(pairs.rows[0].count), unbalancedPairs: Number(unbalanced.rows[0].count), overCap };
  });
  return { status: 200, body: report };
});
