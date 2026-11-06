import { toIso } from '../../shared/time';
import { requireCaller, type AccountRow } from '../auth';
import { ApiError } from '../errors';
import { jsonReply, type Router } from '../http';
import type { Entitlement } from '../entitlement';
import { accountJson } from '../serialize';
import type { Services } from '../services';
import type { Sweeper } from '../sweep';

interface CountsRow {
  account_id: string;
  vault_count: string;
  blob_count: string;
  stored_bytes: string;
}

export function registerOpsRoutes(router: Router, services: Services, sweeper: Sweeper): void {
  const { db } = services;

  const requireOperator = async (ctx: Parameters<Parameters<Router['add']>[2]>[0]): Promise<void> => {
    const caller = await requireCaller(db, ctx);
    if (!caller.account.operator) throw new ApiError(403, 'not_operator', 'This console is for operators.');
  };

  router.add('GET', '/api/ops/accounts', async (ctx) => {
    await requireOperator(ctx);
    const accounts = await db.query<AccountRow>(
      'select id, email, display_name, password_hash, time_zone, operator from accounts order by email',
    );

    const now = new Date();
    const counts = await db.query<CountsRow>(
      `select v.owner_account_id as account_id,
              count(distinct v.id)::text as vault_count,
              count(r.rev)::text as blob_count,
              coalesce(sum(r.byte_length), 0)::text as stored_bytes
         from vaults v left join revisions r on r.vault_id = v.id
        group by v.owner_account_id`,
    );
    const live = await db.query<{ account_id: string; slug: string; published_at: Date | null }>(
      `select account_id, slug, published_at from dossiers
        where state = 'published' and live_publish_id is not null
        order by slug`,
    );

    let source: 'killbill' | 'cache' = 'killbill';
    const plansByAccount = new Map<string, Entitlement | null>();
    const batchSize = 8;
    for (let start = 0; start < accounts.length; start += batchSize) {
      const batch = accounts.slice(start, start + batchSize);
      const read = await Promise.all(
        batch.map((account) => services.entitlement.read(account, now).catch(() => null)),
      );
      batch.forEach((account, index) => plansByAccount.set(account.id, read[index] ?? null));
    }

    const rows = accounts.map((account) => {
      const plans = plansByAccount.get(account.id) ?? null;
      if (!plans || plans.source === 'cache') source = 'cache';
      const count = counts.find((entry) => entry.account_id === account.id);
      return {
        account: accountJson(account),
        sync: plans?.sync ?? null,
        publish: plans?.publish ?? null,
        vault_count: Number(count?.vault_count ?? '0'),
        blob_count: Number(count?.blob_count ?? '0'),
        stored_bytes: Number(count?.stored_bytes ?? '0'),
        live_dossiers: live
          .filter((dossier) => dossier.account_id === account.id)
          .map((dossier) => ({
            slug: dossier.slug,
            published_at: dossier.published_at ? toIso(dossier.published_at) : null,
          })),
      };
    });

    return jsonReply(200, { source, accounts: rows });
  });

  router.add('POST', '/api/ops/sweep', async (ctx) => {
    await requireOperator(ctx);
    const result = await sweeper.run();
    if (!result) throw new ApiError(409, 'sweep_running', 'A lapse check is already running.');
    return jsonReply(200, result);
  });
}
