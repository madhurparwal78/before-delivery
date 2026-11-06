import { q } from './db';
import { kb } from './killbill';
import { freshSnapshot, deadlineWith, type EntitlementSnapshot } from './entitlement';
import { syncGraceSeconds, publishRetentionSeconds, publishWarningLeadSeconds } from './config';

export type AddonState = 'none' | 'active' | 'ending' | 'grace' | 'lapsed';

export interface AddonInfo {
  state: AddonState;
  period_end: string | null;
  checked_at: string | null;
  source: 'killbill' | 'cache';
}

export interface AccountBilling {
  sync: (AddonInfo & { writable_until: string | null }) & Record<string, unknown>;
  publish: (AddonInfo & { warning_at: string | null; takedown_at: string | null }) & Record<string, unknown>;
}

interface CacheRow {
  sync_state: string;
  sync_period_end: Date | null;
  sync_checked: Date | null;
  publish_state: string;
  publish_period_end: Date | null;
  publish_checked: Date | null;
}

const classify = (snapshot: EntitlementSnapshot, now: number, deadline: Date | null): AddonState => {
  if (snapshot.state === 'none') return 'none';
  if (snapshot.period_end === null) return 'active';
  const pe = snapshot.period_end.getTime();
  if (pe > now) return 'ending';
  if (deadline === null || deadline.getTime() > now) return 'grace';
  return 'lapsed';
};


const ts = (d: Date | null): string | null => (d ? d.toISOString().replace(/\.\d{3}Z$/, 'Z') : null);

const readCache = async (accountId: string): Promise<CacheRow | null> => {
  const r = await q<CacheRow>('select * from billing where account_id = $1', [accountId]);
  return r.rows[0] ?? null;
};

const writeCache = async (accountId: string, addon: 'sync' | 'publish', snapshot: EntitlementSnapshot): Promise<void> => {
  await q(
    `insert into billing(account_id, ${addon}_state, ${addon}_period_end, ${addon}_checked)
     values ($1, $2, $3, $4)
     on conflict (account_id) do update set ${addon}_state = $2, ${addon}_period_end = $3, ${addon}_checked = $4`,
    [accountId, snapshot.state, snapshot.period_end, snapshot.checked_at],
  );
};

/** Read entitlement for one add-on. Throws when Kill Bill is down and nothing is cached; callers map that to billing_unavailable. */
export const readAddon = async (
  accountId: string,
  addon: 'sync' | 'publish',
): Promise<EntitlementSnapshot & { state: AddonState; deadline: Date | null }> => {
  const graceSeconds = syncGraceSeconds();
  const retentionSeconds = publishRetentionSeconds();
  const sub = await kb.getSubscriptionByExternalKey(accountId, addon);
  if (sub.ok) {
    const snap = freshSnapshot(sub.value.subscription_id ? sub.value : null);
    await writeCache(accountId, addon, snap);
    const d = addon === 'sync'
      ? deadlineWith(snap.period_end, 7, graceSeconds)
      : deadlineWith(snap.period_end, 14, retentionSeconds);
    return { ...snap, state: classify(snap, Date.now(), d), deadline: d };
  }
  const cache = await readCache(accountId);
  const cachedState = addon === 'sync' ? cache?.sync_state : cache?.publish_state;
  const snap: EntitlementSnapshot = {
    state: cachedState === 'active' || cachedState === 'ending' ? cachedState : 'none',
    period_end: (addon === 'sync' ? cache?.sync_period_end : cache?.publish_period_end) ?? null,
    checked_at: (addon === 'sync' ? cache?.sync_checked : cache?.publish_checked) ?? new Date(0),
    source: 'cache',
  };
  const d = addon === 'sync'
    ? deadlineWith(snap.period_end, 7, graceSeconds)
    : deadlineWith(snap.period_end, 14, retentionSeconds);
  return { ...snap, state: classify(snap, Date.now(), d), deadline: d };
};

export const syncWritableUntil = (periodEnd: Date | null): Date | null =>
  deadlineWith(periodEnd, 7, syncGraceSeconds());

export const publishTakedownAt = (periodEnd: Date | null): Date | null =>
  deadlineWith(periodEnd, 14, publishRetentionSeconds());

export const publishWarningAt = (takedown: Date | null): Date | null =>
  takedown ? new Date(takedown.getTime() - publishWarningLeadSeconds() * 1000) : null;

export const buildBilling = async (accountId: string): Promise<AccountBilling> => {
  const sync = await readAddon(accountId, 'sync');
  const publish = await readAddon(accountId, 'publish');
  const syncTakedown = syncWritableUntil(sync.period_end);
  const publishTakedown = publishTakedownAt(publish.period_end);
  return {
    sync: {
      state: sync.state,
      period_end: ts(sync.period_end),
      checked_at: ts(sync.checked_at),
      source: sync.source,
      writable_until: ts(syncTakedown),
    },
    publish: {
      state: publish.state,
      period_end: ts(publish.period_end),
      checked_at: ts(publish.checked_at),
      source: publish.source,
      warning_at: ts(publishWarningAt(publishTakedown)),
      takedown_at: ts(publishTakedown),
    },
  };
};

export const vaultSyncState = async (ownerId: string): Promise<'active' | 'ending' | 'grace' | 'lapsed' | 'none'> => {
  const s = await readAddon(ownerId, 'sync');
  return s.state === 'none' ? 'none' : s.state;
};

export const setSubscription = async (
  accountId: string,
  addon: 'sync' | 'publish',
  subscribe: boolean,
  accountInfo: { display_name: string; email: string; time_zone: string },
): Promise<void> => {
  const info = await kb.ensureAccount(accountId, accountInfo.display_name, accountInfo.email, accountInfo.time_zone);
  if (!info.ok || !info.value.account_id) throw new Error('killbill');
  const sub = await kb.getSubscriptionByExternalKey(accountId, addon);
  if (!sub.ok) throw new Error('killbill');
  if (subscribe && !sub.value.subscription_id) {
    const r = await kb.subscribe(accountId, info.value.account_id, addon);
    if (!r.ok) throw new Error('killbill');
    await writeCache(accountId, addon, { state: 'active', period_end: null, checked_at: new Date(), source: 'killbill' });
  } else if (!subscribe && sub.value.subscription_id) {
    const r = await kb.cancelSubscription(sub.value.subscription_id);
    if (!r.ok) throw new Error('killbill');
  }
};


export const refreshAllEntitlements = async (accountIds: string[]): Promise<void> => {
  for (const id of accountIds) {
    const sync = await kb.getSubscriptionByExternalKey(id, 'sync');
    if (sync.ok) {
      const snap = freshSnapshot(sync.value.subscription_id ? sync.value : null);
      await writeCache(id, 'sync', snap);
    }
    const publish = await kb.getSubscriptionByExternalKey(id, 'publish');
    if (publish.ok) {
      const snap = freshSnapshot(publish.value.subscription_id ? publish.value : null);
      await writeCache(id, 'publish', snap);
    }
  }
};
