import { ApiError, type Ctx } from '../api_types';
import { q } from '../db';
import { requireAccount, whenInZone } from './core';
import { buildBilling, readAddon, publishTakedownAt } from '../billing';
import { route } from './auth_routes';
import { publishWarningEmail } from '../mail';
import { config } from '../config';
import { deletePrefix } from '../s3';

const requireOperator = (ctx: Ctx): void => {
  const account = requireAccount(ctx);
  if (!account.operator) throw new ApiError('not_operator', 'Operators only.');
};

route('GET', '/api/ops/accounts', async (ctx) => {
  requireOperator(ctx);
  const accounts = await q<{ id: string; email: string; display_name: string; time_zone: string; operator: boolean }>(
    'select id, email, display_name, time_zone, operator from accounts order by created_at',
  );
  const entries = await Promise.all(accounts.rows.map(async (a) => {
    const billing = await buildBilling(a.id);
    const vaults = await q<{ n: string }>('select count(*)::text as n from vaults where owner_id = $1', [a.id]);
    const blobs = await q<{ n: string; bytes: string }>(
      `select count(*)::text as n, coalesce(sum(byte_length),0)::text as bytes
       from revisions where vault_id in (select id from vaults where owner_id = $1)`,
      [a.id],
    );
    const live = await q<{ slug: string; published_at: Date }>(
      `select slug, published_at from dossiers where account_id = $1 and state = 'published' and publish_id is not null`,
      [a.id],
    );
    return {
      account: { id: a.id, email: a.email, display_name: a.display_name, time_zone: a.time_zone, operator: a.operator },
      sync: billing.sync,
      publish: billing.publish,
      vault_count: Number(vaults.rows[0]?.n ?? 0),
      blob_count: Number(blobs.rows[0]?.n ?? 0),
      stored_bytes: Number(blobs.rows[0]?.bytes ?? 0),
      live_dossiers: live.rows.map((d) => ({ slug: d.slug, published_at: d.published_at.toISOString().replace(/\.\d{3}Z$/, 'Z') })),
    };
  }));
  // when a Kill Bill read succeeded live the console reports the live source, otherwise the cache
  const source: 'killbill' | 'cache' = entries.some((e) => e.sync.source === 'killbill' || e.publish.source === 'killbill')
    ? 'killbill'
    : 'cache';
  return { status: 200, body: { source, accounts: entries } };
});

let sweepRunning = false;

export const runSweep = async (): Promise<{ warnings_sent: number; dossiers_taken_down: number; objects_removed: number }> => {
  if (sweepRunning) throw new ApiError('sweep_running', 'A lapse check is already running.');
  sweepRunning = true;
  try {
    return await sweepInner();
  } finally {
    sweepRunning = false;
  }
};

const sweepInner = async (): Promise<{ warnings_sent: number; dossiers_taken_down: number; objects_removed: number }> => {
  let warningsSent = 0;
  let takenDown = 0;
  let objectsRemoved = 0;
  // seeded add-ons get their Kill Bill subscriptions when Kill Bill answers
  const { syncSeededAddons } = await import('../seed');
  await syncSeededAddons();
  // 1. refresh entitlement for accounts with a non-none addon
  const accounts = await q<{ id: string; email: string; time_zone: string; operator: boolean }>(
    'select id, email, time_zone, operator from accounts',
  );
  for (const a of accounts.rows) {
    await readAddon(a.id, 'sync');
    await readAddon(a.id, 'publish');
  }
  // 2. warning emails, once per lapse
  for (const a of accounts.rows) {
    const publish = await readAddon(a.id, 'publish');
    const takedown = publishTakedownAt(publish.period_end);
    if (!takedown || publish.state === 'none') continue;
    const warned = await q<{ sent_at: Date }>('select sent_at from warns where account_id = $1', [a.id]);
    const live = await q<{ slug: string }>(
      `select slug from dossiers where account_id = $1 and state = 'published' and publish_id is not null`,
      [a.id],
    );
    if (live.rows.length === 0) continue;
    if (takedown.getTime() - Date.now() <= 0) {
      // takedown due: only if a warning went out in an earlier sweep
      if (!warned.rows[0]) continue;
      for (const d of live.rows) {
        const row = await q<{ id: string; slug: string }>(
          'select id, slug from dossiers where account_id = $1 and slug = $2 and state = $3',
          [a.id, d.slug, 'published'],
        );
        const dossier = row.rows[0];
        if (!dossier) continue;
        // clear the pointer first; the state only becomes lapsed once every object is gone
        await q('update dossiers set publish_id = null where id = $1', [dossier.id]);
        try {
          objectsRemoved += await deletePrefix(`publish/${dossier.slug}/`);
        } catch {
          // retry next sweep
          continue;
        }
        await q('update dossiers set state = $2 where id = $1', [dossier.id, 'lapsed']);
        takenDown++;
      }
      continue;
    }
    const warnAt = takedown.getTime() - 3 * 24 * 3600 * 1000;
    const due = Date.now() >= warnAt;
    if (due && !warned.rows[0]) {
      const whenText = whenInZone(takedown, a.time_zone);
      await publishWarningEmail(a.email, whenText, live.rows.map((d) => `${config.publicUrl}/d/${d.slug}/`));
      await q(
        'insert into warns(account_id, sent_at) values ($1, now()) on conflict (account_id) do update set sent_at = now()',
        [a.id],
      );
      warningsSent++;
    }
  }
  // 4. delete objects for ended preview links and publishes that never went live
  const endedLinks = await q<{ id: string }>(
    `select id from preview_links where state in ('revoked','replaced','expired')`,
  );
  for (const l of endedLinks.rows) {
    try {
      const n = await deletePrefix(`preview/${l.id}/`);
      if (n > 0) objectsRemoved += n;
    } catch {
      // retry next sweep
    }
  }
  const stale = await q<{ id: string; slug: string }>(
    `select p.id, d.slug from publishes p join dossiers d on d.id = p.dossier_id
     where p.publish_key <> coalesce(d.publish_id, '')`,
  );
  for (const p of stale.rows) {
    try {
      const n = await deletePrefix(`publish/${p.slug}/${p.id}/`);
      if (n > 0) objectsRemoved += n;
    } catch {
      // retry next sweep
    }
  }
  // 5. retry unsent emails
  const { mail } = await import('../mail');
  await mail.flush();
  return { warnings_sent: warningsSent, dossiers_taken_down: takenDown, objects_removed: objectsRemoved };
};

route('POST', '/api/ops/sweep', async (ctx) => {
  requireOperator(ctx);
  const result = await runSweep();
  return { status: 200, body: result };
});
