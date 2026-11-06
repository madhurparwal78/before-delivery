// Health, service status and the operator's ledger check.
import { RESOURCES } from '../shared/catalog';
import { databaseUp, tx } from './db';
import { publicRoute, sessionRoute } from './http';
import { storageCaps, type BuildingRow } from './island';
import { mailUp, queuedMailCount } from './mail';

publicRoute('GET', '/api/health', async () => ({ status: 200, body: { status: 'ok' } }));

publicRoute('GET', '/api/status', async () => ({
  status: 200,
  body: { database: databaseUp() ? 'up' : 'down', mail: mailUp() ? 'up' : 'down' },
}));

sessionRoute('GET', '/api/ops/status', async () => {
  const queuedMail = await tx((db) => queuedMailCount(db));
  return { status: 200, body: { database: 'up', mail: mailUp() ? 'up' : 'down', queuedMail } };
}, { operator: true });

sessionRoute('GET', '/api/ops/ledger/check', async () => {
  const body = await tx(async (db) => {
    const pairs = await db.query<{ pairs: number; unbalanced: number }>(
      `SELECT count(*)::bigint AS pairs, count(*) FILTER (WHERE total <> 0 OR rows_in_pair <> 2)::bigint AS unbalanced
         FROM (SELECT pair_id, SUM(amount) AS total, count(*) AS rows_in_pair FROM ledger_entries GROUP BY pair_id) p`,
    );
    const balances = await db.query<{ village_id: number; asset: string; total: number }>(
      "SELECT village_id, asset, SUM(amount)::bigint AS total FROM ledger_entries WHERE village_id IS NOT NULL AND asset IN ('brine', 'peat', 'copper') GROUP BY village_id, asset",
    );
    const buildings = await db.query<BuildingRow & { village_id: number }>('SELECT * FROM buildings');
    const byVillage = new Map<number, BuildingRow[]>();
    for (const b of buildings.rows) byVillage.set(b.village_id, [...(byVillage.get(b.village_id) ?? []), b]);
    const overCap = balances.rows.filter((row) => {
      const caps = storageCaps(byVillage.get(row.village_id) ?? []);
      const resource = RESOURCES.find((r) => r === row.asset);
      return resource !== undefined && row.total > caps[resource];
    }).length;
    const totals = pairs.rows[0] as { pairs: number; unbalanced: number };
    return { pairs: totals.pairs, unbalancedPairs: totals.unbalanced, overCap };
  });
  return { status: 200, body };
}, { operator: true });
