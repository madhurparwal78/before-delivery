import { randomUUID } from 'node:crypto';
import { errors } from '../http/errors.js';
import type { SessionUser } from '../http/context.js';
import { withTransaction } from '../db/pool.js';
import { findHourPack } from '../db/repo/catalog.js';
import { balanceMinutes, listEntries, recordMovement } from '../db/repo/ledger.js';
import { recordStateChange } from '../db/repo/audit.js';
import { purchase } from '../providers/killbill.js';
import type { LedgerEntryRecord } from '../domain/types.js';
import { billingAccountFor, requireTenant } from './tenants.js';

export interface PurchaseResult {
  purchase_id: string;
  pack_id: string;
  minutes: number;
  price_cents: number;
  balance_minutes: number;
}

export async function purchaseHourPack(
  actor: SessionUser,
  packId: string,
): Promise<PurchaseResult> {
  const pack = await findHourPack(packId);
  if (!pack) throw errors.validation({ pack_id: 'Choose an hour pack.' });
  const tenant = await requireTenant(actor.tenantId!);
  const accountId = await billingAccountFor(tenant);
  const purchaseId = randomUUID();

  await purchase(accountId, pack.priceCents, `pack-${purchaseId}`);

  const balance = await withTransaction(async (tx) => {
    await recordMovement(tx, tenant.id, pack.minutes, 'pack_purchase', null);
    await recordStateChange(tx, {
      actorUserId: actor.id,
      entity: 'hour_pack_purchase',
      entityId: purchaseId,
      fromState: null,
      toState: 'recorded',
      detail: { pack_id: pack.id, minutes: pack.minutes },
    });
    return balanceMinutes(tenant.id, tx);
  });

  return {
    purchase_id: purchaseId,
    pack_id: pack.id,
    minutes: pack.minutes,
    price_cents: pack.priceCents,
    balance_minutes: balance,
  };
}

export async function hourLedger(
  tenantId: string,
): Promise<{ tenantId: string; balanceMinutes: number; entries: LedgerEntryRecord[] }> {
  return {
    tenantId,
    balanceMinutes: await balanceMinutes(tenantId),
    entries: await listEntries(tenantId),
  };
}
