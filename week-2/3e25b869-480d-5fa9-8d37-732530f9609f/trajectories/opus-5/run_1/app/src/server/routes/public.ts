import { FIELD_MESSAGES } from '../../shared/copy.js';
import { DEFAULT_PROVINCE, isProvinceCode } from '../../shared/money.js';
import type { ProvinceCode } from '../../shared/types.js';
import { db } from '../db/pool.js';
import { PUBLIC_STATES } from '../domain/batches.js';
import type { ApiResponse, RequestContext } from '../http/context.js';
import { errors } from '../http/errors.js';
import { byDropThenCode, loadBatch, loadBatches, publicBatch } from '../repo/batches.js';
import { buildCart } from '../repo/cart.js';
import { billingStatus } from '../services/billing-status.js';
import { mailStatus } from '../services/outbox.js';

export async function getStatus(): Promise<ApiResponse> {
  const billing = billingStatus();
  const mail = mailStatus();
  const checkedAt = new Date(Math.max(billing.checkedAt.getTime(), mail.checkedAt.getTime()));
  return {
    status: 200,
    body: {
      billing: billing.up ? 'up' : 'down',
      mail: mail.up ? 'up' : 'down',
      checked_at: checkedAt.toISOString(),
    },
  };
}

export async function getDrop(): Promise<ApiResponse> {
  const now = new Date();
  const batches = await loadBatches(db, now, null);
  const shown = batches.filter((batch) => PUBLIC_STATES.includes(batch.state)).sort(byDropThenCode);
  return {
    status: 200,
    body: { server_now: now.toISOString(), batches: shown.map(publicBatch) },
  };
}

export async function getBatch(ctx: RequestContext): Promise<ApiResponse> {
  const now = new Date();
  const code = ctx.params['code'] ?? '';
  const batch = await loadBatch(db, now, code);
  if (!batch || !PUBLIC_STATES.includes(batch.state)) throw errors.notFound();
  return { status: 200, body: publicBatch(batch) };
}

export function readProvinceQuery(ctx: RequestContext): ProvinceCode {
  const raw = ctx.query.get('province');
  if (raw === null || raw === '') return DEFAULT_PROVINCE;
  if (!isProvinceCode(raw)) throw errors.invalid({ province: FIELD_MESSAGES.province });
  return raw;
}

export async function getCart(ctx: RequestContext): Promise<ApiResponse> {
  const province = readProvinceQuery(ctx);
  const now = new Date();
  return { status: 200, body: await buildCart(db, ctx.cartId, province, now) };
}
