import type { DbClient, Row } from './db.js';
import { clientQuery } from './db.js';
import type { AppContext, SessionUser } from './context.js';
import { memberById } from './context.js';
import { nowMs } from '../clock.js';
import { datePlusDays, localDateOfInstant } from '../sitetime.js';
import { ApiError } from './errors.js';
import { uuid } from './ids.js';
import { writeMovement, loadLots } from './ledger.js';
import { queueMail } from './mail.js';
import { balancesFor } from './bookingService.js';
import { LOT_VALID_DAYS } from './rules.js';
import { formatMoney } from '../labels.js';
import type { Json } from '../types.js';

/** A pack purchase: Kill Bill charge, ledger credit and receipt email together. */
export async function purchasePack(
  ctx: AppContext,
  client: DbClient,
  actor: SessionUser,
  packId: string,
): Promise<{ body: Json; purchaseId: string }> {
  const packRows = await clientQuery<Row>(client, `SELECT * FROM packs WHERE id = $1 AND tenant_id = $2`, [packId, actor.tenantId]);
  const pack = packRows[0];
  if (!pack) throw new ApiError(404, 'not_found', 'There is nothing here.');
  const member = await memberById(client, actor.userId);
  if (!member) throw new ApiError(404, 'not_found', 'There is nothing here.');
  const at = nowMs();

  // 1. Kill Bill charge first; nothing is stored when billing refuses.
  let paymentId: string;
  try {
    const account = await ctx.killbill.ensureAccount({
      externalKey: actor.userId,
      name: String(member.business_name ?? member.name),
      email: String(member.email),
    });
    const payment = await ctx.killbill.createPackPayment({
      accountId: account.accountId,
      paymentMethodId: account.paymentMethodId,
      transactionExternalKey: `purchase-${uuid()}`,
      amountDollars: Number(pack.price_cents) / 100,
    });
    paymentId = payment.paymentId;
  } catch {
    throw new ApiError(503, 'billing_unavailable', 'Billing is unreachable right now.');
  }

  const purchaseId = uuid();
  const homeZone = await homeZoneFor(client, actor.userId);
  const validThrough = datePlusDays(siteLocalDateFor(homeZone), LOT_VALID_DAYS);
  await clientQuery(
    client,
    `INSERT INTO purchases (id, member_id, pack_id, pack_name, quarter_hours, price_cents, valid_through, killbill_payment_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      purchaseId,
      actor.userId,
      pack.id,
      pack.name,
      Number(pack.quarter_hours),
      Number(pack.price_cents),
      validThrough,
      paymentId,
      at,
    ],
  );
  const lotResult = await clientQuery<{ id: string }>(
    client,
    `INSERT INTO lots (member_id, purchase_id, pack_name, valid_through, remainder_qh, purchase_seq, created_at)
     VALUES ($1, $2, $3, $4, $5, (SELECT COALESCE(MAX(purchase_seq), 0) + 1 FROM lots WHERE member_id = $1), $6)
     RETURNING id`,
    [actor.userId, purchaseId, pack.name, validThrough, Number(pack.quarter_hours), at],
  );
  await writeMovement(client, {
    memberId: actor.userId,
    tenantId: actor.tenantId,
    kind: 'pack_purchase',
    fromAccount: 'pack_sales',
    toAccount: 'available',
    quarterHours: Number(pack.quarter_hours),
    purchaseId,
    actor: { userId: actor.userId, name: actor.name, role: 'member' },
    atMs: at,
    lots: [{ lotId: Number(lotResult[0].id), purchaseId, quarterHours: Number(pack.quarter_hours) }],
  });
  const balances = await balancesFor(client, actor.userId);
  await queueMail(client, actor.tenantId, {
    kind: 'pack_receipt',
    to: String(member.email),
    packName: String(pack.name),
    hours: Number(pack.quarter_hours) / 4,
    price: `$${formatMoney(Number(pack.price_cents))}`,
    purchaseId,
    validThrough,
    availableAfter: (balances as { available_hours: number }).available_hours,
  });
  return {
    body: {
      purchase: {
        id: purchaseId,
        pack_id: String(pack.id),
        pack_name: String(pack.name),
        hours: Number(pack.quarter_hours) / 4,
        price_cents: Number(pack.price_cents),
        valid_through: validThrough.slice(0, 10),
        killbill_payment_id: paymentId,
        created_at: new Date(at).toISOString().replace(/(\.\d{3})Z$/, '$1Z'),
      },
      balances,
    } as unknown as Json,
    purchaseId,
  };
}

export async function homeZoneFor(client: DbClient, memberId: string): Promise<string> {
  const member = await memberById(client, memberId);
  if (member?.site_id) {
    const site = await clientQuery<Row>(client, `SELECT time_zone FROM sites WHERE id = $1`, [member.site_id]);
    if (site.length > 0) return String(site[0].time_zone);
  }
  return 'UTC';
}

export function siteLocalDateFor(zone: string): string {
  return localDateOfInstant(nowMs(), zone);
}
