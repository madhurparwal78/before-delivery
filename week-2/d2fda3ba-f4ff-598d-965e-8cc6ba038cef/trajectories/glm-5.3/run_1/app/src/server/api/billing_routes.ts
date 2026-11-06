import { ApiError } from '../api_types';
import { q } from '../db';
import { requireAccount } from './core';
import { buildBilling, setSubscription } from '../billing';
import { route } from './auth_routes';

route('GET', '/api/billing', async (ctx) => {
  const account = requireAccount(ctx);
  return { status: 200, body: await buildBilling(account.id) };
});

const accountInfoFor = async (id: string): Promise<{ display_name: string; email: string; time_zone: string }> => {
  const r = await q<{ display_name: string; email: string; time_zone: string }>(
    'select display_name, email, time_zone from accounts where id = $1', [id],
  );
  return r.rows[0];
};

route('POST', '/api/billing/subscriptions', async (ctx) => {
  const account = requireAccount(ctx);
  const b = (ctx.body?.json() ?? {}) as { addon?: unknown };
  const addon = b.addon;
  if (addon !== 'sync' && addon !== 'publish')
    throw new ApiError('validation_failed', 'Check the highlighted fields.', { fields: { addon: 'must be "sync" or "publish"' } });
  const info = await accountInfoFor(account.id);
  const current = await buildBilling(account.id);
  if (current[addon as 'sync' | 'publish'].state !== 'none' && current[addon as 'sync' | 'publish'].state !== 'lapsed')
    throw new ApiError('already_subscribed', 'This add-on is already on the account.');
  try {
    await setSubscription(account.id, addon, true, info);
  } catch {
    throw new ApiError('billing_unavailable', 'Billing is unavailable. Your plan hasn\'t changed — try again shortly.');
  }
  return { status: 201, body: await buildBilling(account.id) };
});

route('DELETE', '/api/billing/subscriptions/<addon>', async (ctx, params) => {
  const account = requireAccount(ctx);
  const addon = params[0];
  if (addon !== 'sync' && addon !== 'publish')
    throw new ApiError('validation_failed', 'Check the highlighted fields.', { fields: { addon: 'must be "sync" or "publish"' } });
  const current = await buildBilling(account.id);
  const state = current[addon].state;
  if (state === 'none') throw new ApiError('not_subscribed', 'This add-on is not on the account.');
  const info = await accountInfoFor(account.id);
  try {
    await setSubscription(account.id, addon, false, info);
  } catch {
    throw new ApiError('billing_unavailable', 'Billing is unavailable. Your plan hasn\'t changed — try again shortly.');
  }
  return { status: 200, body: await buildBilling(account.id) };
});
