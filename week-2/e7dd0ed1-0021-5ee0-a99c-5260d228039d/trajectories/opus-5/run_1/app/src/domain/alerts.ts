import { query, transaction } from '../db';
import { currentPeriod, monthToDate } from './usage';
import { planById } from './seeddata';
import { mailThreshold } from './notifications';

/** One email per threshold, metric and UTC month, the first time usage reaches it. */
export async function checkThresholds(slug: string): Promise<void> {
  const workspace = await query<{ name: string; plan_id: string; stored: string }>(
    `select w.name, w.plan_id, coalesce((select sum(stored_bytes) from buckets where workspace_slug = w.slug), 0)::text as stored
     from workspaces w where w.slug = $1`,
    [slug],
  );
  if (workspace.length === 0) return;
  const plan = planById(workspace[0].plan_id);
  const period = currentPeriod();
  const totals = await monthToDate(slug, period);
  const metrics: { metric: 'storage' | 'egress'; current: number; included: number }[] = [
    { metric: 'storage', current: Number(workspace[0].stored), included: plan.includedStorageBytes },
    { metric: 'egress', current: totals.egressBytes, included: plan.includedEgressBytes },
  ];
  for (const entry of metrics) {
    for (const threshold of [80, 100] as const) {
      if (entry.included <= 0) continue;
      if ((entry.current / entry.included) * 100 < threshold) continue;
      await transaction(async (client) => {
        const inserted = await client.query(
          `insert into threshold_alerts (workspace_slug, metric, threshold, period) values ($1, $2, $3, $4)
           on conflict do nothing returning metric`,
          [slug, entry.metric, threshold, period],
        );
        if (inserted.rowCount === 0) return;
        await mailThreshold(client, slug, {
          workspaceName: workspace[0].name,
          metric: entry.metric,
          threshold,
          currentBytes: entry.current,
          includedBytes: entry.included,
        });
      });
    }
  }
}
