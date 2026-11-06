import type { AddonName } from '../../shared/addons';
import { publishAllowed } from '../../shared/addons';
import { requireCaller, type AccountRow } from '../auth';
import { ApiError, billingUnavailable, validationFailed } from '../errors';
import { jsonReply, type Router } from '../http';
import { BillingUnavailableError } from '../killbill';
import type { Services } from '../services';

function addonOf(value: unknown): AddonName {
  if (value !== 'sync' && value !== 'publish') {
    throw validationFailed({ addon: 'must be "sync" or "publish"' });
  }
  return value;
}

function addonsJson(sync: unknown, publish: unknown): Record<string, unknown> {
  return { sync, publish };
}

export function registerBillingRoutes(router: Router, services: Services): void {
  const { db } = services;

  router.add('GET', '/api/billing', async (ctx) => {
    const caller = await requireCaller(db, ctx);
    const plans = await services.entitlement.read(caller.account);
    return jsonReply(200, addonsJson(plans.sync, plans.publish));
  });

  router.add('POST', '/api/billing/subscriptions', async (ctx) => {
    const caller = await requireCaller(db, ctx);
    const addon = addonOf((ctx.body as { addon?: unknown } | undefined)?.addon);

    try {
      const kbAccountId = await services.billing.ensureAccount({
        accountId: caller.account.id,
        displayName: caller.account.display_name,
        email: caller.account.email,
        timeZone: caller.account.time_zone,
      });
      await services.entitlement.rememberKillBillAccount(caller.account.id, kbAccountId);

      const current = await services.entitlement.read(caller.account);
      const live = addon === 'sync' ? current.sync : current.publish;
      if (addon === 'sync' ? live.state === 'active' || live.state === 'ending' : publishAllowed(live.state)) {
        throw new ApiError(409, 'already_subscribed', `${addon === 'sync' ? 'Sync' : 'Publish'} is already active.`);
      }

      await services.billing.createSubscription(kbAccountId, caller.account.id, addon);
      const refreshed = await services.entitlement.read(caller.account);
      await clearLapseRecords(services, caller.account, addon);
      return jsonReply(201, addonsJson(refreshed.sync, refreshed.publish));
    } catch (error) {
      if (error instanceof BillingUnavailableError) throw billingUnavailable();
      throw error;
    }
  });

  router.add('DELETE', '/api/billing/subscriptions/:addon', async (ctx) => {
    const caller = await requireCaller(db, ctx);
    const addon = addonOf(ctx.params.addon);

    try {
      const kbAccountId = await services.entitlement.killBillAccountId(caller.account.id);
      if (!kbAccountId) throw new ApiError(409, 'not_subscribed', 'There is nothing to cancel.');
      const records = await services.billing.readSubscriptions(kbAccountId);
      const current = await services.entitlement.read(caller.account);
      const state = addon === 'sync' ? current.sync.state : current.publish.state;
      const subscriptionId = records[addon].subscriptionId;
      if (state !== 'active' || !subscriptionId) {
        throw new ApiError(409, 'not_subscribed', 'There is nothing to cancel.');
      }

      await services.billing.cancelSubscription(subscriptionId);
      const refreshed = await services.entitlement.read(caller.account);
      return jsonReply(200, addonsJson(refreshed.sync, refreshed.publish));
    } catch (error) {
      if (error instanceof BillingUnavailableError) throw billingUnavailable();
      throw error;
    }
  });
}

/** A fresh subscription clears the warning record of the previous lapse. */
async function clearLapseRecords(services: Services, account: AccountRow, addon: AddonName): Promise<void> {
  if (addon !== 'publish') return;
  await services.db.query('delete from publish_warnings where account_id = $1', [account.id]);
}
