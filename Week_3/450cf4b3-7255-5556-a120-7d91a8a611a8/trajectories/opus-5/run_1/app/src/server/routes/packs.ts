import { randomUUID } from 'node:crypto';
import { query, queryOne, transactionNow, withTransaction, type Db } from '../db';
import { kitchenIso } from '../kitchen-time';
import { PACK_CATALOGUE, STEP_UP_PACK_HOURS, serverMessage } from '../../shared/copy';
import { lockPack, packById, packsOfTenant, refundableCentsOf, writeMovement } from '../domain/packs';
import { packReceiptMail, queueMail } from '../domain/mail';
import { tenantById } from '../domain/tenants';
import { nudgeMailQueue } from '../mail-worker';
import {
  BillingUnavailableError,
  createAccount,
  createPackInvoice,
  findAccount,
  findPayment,
  payInvoice,
  refundPayment,
  voidInvoice,
} from '../services/killbill';
import { ApiError, conflict, notFound, unauthenticated } from '../http/errors';
import { finishValidation } from '../http/validate';
import { packDetailView, packView } from '../views';
import type { Ctx, Reply, Route } from '../http/route';

interface AttemptRow {
  id: string;
  state: 'started' | 'invoiced' | 'paid' | 'recorded';
  killbill_invoice_id: string | null;
  killbill_payment_id: string | null;
  pack_id: string | null;
}

const ATTEMPT_COLUMNS = 'id, state, killbill_invoice_id, killbill_payment_id, pack_id';

function billingUnavailable(message: string): ApiError {
  return new ApiError(503, 'billing_unavailable', message);
}

async function attemptFor(
  client: Db,
  userId: string,
  tenantId: string,
  key: string,
  hours: number,
  priceCents: number,
): Promise<AttemptRow> {
  await query(
    client,
    `insert into purchase_attempts (id, user_id, tenant_id, endpoint, idempotency_key, hours, price_cents, state)
     values ($1,$2,$3,'POST /api/packs',$4,$5,$6,'started')
     on conflict (user_id, endpoint, idempotency_key) do nothing`,
    [randomUUID(), userId, tenantId, key, hours, priceCents],
  );
  const attempt = await queryOne<AttemptRow>(
    client,
    `select ${ATTEMPT_COLUMNS} from purchase_attempts
     where user_id = $1 and endpoint = 'POST /api/packs' and idempotency_key = $2`,
    [userId, key],
  );
  if (attempt === null) throw billingUnavailable(serverMessage.billingUnavailablePurchase);
  return attempt;
}

async function killBillAccountOf(client: Db, tenantId: string): Promise<string> {
  const tenant = await tenantById(client, tenantId);
  if (tenant === null) throw notFound();
  if (tenant.killbill_account_id !== null) return tenant.killbill_account_id;
  const existing = await findAccount(tenantId);
  const account = existing ?? (await createAccount(tenantId, tenant.business_name, tenant.email));
  await query(client, 'update tenants set killbill_account_id = $2 where id = $1', [
    tenantId,
    account.accountId,
  ]);
  return account.accountId;
}

const listPacks: Route = {
  method: 'GET',
  pattern: '/api/packs',
  roles: ['tenant'],
  handler: async (ctx: Ctx): Promise<Reply> => {
    const user = ctx.user;
    if (user === null || user.tenantId === null) throw unauthenticated();
    return withTransaction(async (client) => {
      const now = await transactionNow(client);
      const packs = await packsOfTenant(client, user.tenantId ?? '', now);
      const views = [];
      for (const pack of packs) views.push(await packView(client, pack));
      return { status: 200, body: { packs: views } };
    });
  },
};

const buyPack: Route = {
  method: 'POST',
  pattern: '/api/packs',
  roles: ['tenant'],
  bodyFields: ['hours'],
  requiresKey: true,
  idempotencyBody: (ctx: Ctx) => ({ hours: ctx.body.hours ?? null }),
  reauth: (ctx: Ctx) => STEP_UP_PACK_HOURS.includes(Number(ctx.body.hours)),
  handler: async (ctx: Ctx): Promise<Reply> => {
    const user = ctx.user;
    if (user === null || user.tenantId === null) throw unauthenticated();
    const tenantId = user.tenantId;
    const key = ctx.idempotencyKey ?? '';
    const hours = ctx.body.hours;
    const catalogue = PACK_CATALOGUE.find((entry) => entry.hours === hours);
    const fields: Record<string, string> = {};
    if (catalogue === undefined) fields.hours = serverMessage.packHours;
    finishValidation(ctx, fields);
    if (catalogue === undefined) throw notFound();

    const attempt = await withTransaction((client) =>
      attemptFor(client, user.id, tenantId, key, catalogue.hours, catalogue.priceCents),
    );

    if (attempt.state === 'recorded' && attempt.pack_id !== null) {
      return withTransaction(async (client) => {
        const now = await transactionNow(client);
        const pack = await packById(client, attempt.pack_id ?? '', now);
        if (pack === null) throw notFound();
        return { status: 201, body: await packView(client, pack) };
      });
    }

    const paymentExternalKey = `stationhouse-attempt-${attempt.id}`;
    let invoiceId = attempt.killbill_invoice_id;
    let paymentId = attempt.killbill_payment_id;

    try {
      const accountId = await withTransaction((client) => killBillAccountOf(client, tenantId));
      if (paymentId === null) {
        const alreadyPaid = await findPayment(paymentExternalKey);
        if (alreadyPaid !== null) {
          paymentId = alreadyPaid.paymentId;
        } else {
          if (invoiceId === null) {
            invoiceId = await createPackInvoice(accountId, catalogue.hours, catalogue.priceCents);
            await withTransaction((client) =>
              query(client, `update purchase_attempts set state = 'invoiced', killbill_invoice_id = $2 where id = $1`, [
                attempt.id,
                invoiceId,
              ]),
            );
          }
          try {
            const payment = await payInvoice(
              accountId,
              invoiceId,
              catalogue.priceCents,
              paymentExternalKey,
            );
            paymentId = payment.paymentId;
          } catch (error) {
            await voidInvoice(invoiceId);
            await withTransaction((client) =>
              query(
                client,
                `update purchase_attempts set state = 'started', killbill_invoice_id = null where id = $1`,
                [attempt.id],
              ),
            );
            throw error;
          }
        }
        await withTransaction((client) =>
          query(
            client,
            `update purchase_attempts set state = 'paid', killbill_payment_id = $2 where id = $1`,
            [attempt.id, paymentId],
          ),
        );
      }
    } catch (error) {
      if (error instanceof BillingUnavailableError) {
        throw billingUnavailable(serverMessage.billingUnavailablePurchase);
      }
      throw error;
    }

    if (invoiceId === null) {
      const stored = await withTransaction((client) =>
        queryOne<{ killbill_invoice_id: string | null }>(
          client,
          'select killbill_invoice_id from purchase_attempts where id = $1',
          [attempt.id],
        ),
      );
      invoiceId = stored?.killbill_invoice_id ?? null;
    }
    if (invoiceId === null || paymentId === null) {
      throw new ApiError(503, 'purchase_pending', serverMessage.purchasePending);
    }

    try {
      const reply = await withTransaction(async (client) => {
        const now = await transactionNow(client);
        const packId = randomUUID();
        await query(
          client,
          `insert into packs (id, tenant_id, hours, purchased_minutes, price_cents, status, invoice_id,
             killbill_payment_id, purchased_at)
           values ($1,$2,$3,$4,$5,'active',$6,$7,$8)`,
          [
            packId,
            tenantId,
            catalogue.hours,
            catalogue.hours * 60,
            catalogue.priceCents,
            invoiceId,
            paymentId,
            now,
          ],
        );
        await writeMovement(client, packId, 'purchase', catalogue.hours * 60, null);
        const tenant = await tenantById(client, tenantId);
        if (tenant === null) throw notFound();
        const mail = packReceiptMail({
          hours: catalogue.hours,
          priceCents: catalogue.priceCents,
          invoiceId: invoiceId ?? '',
          purchasedAtIso: kitchenIso(now),
        });
        await queueMail(
          client,
          'pack_receipt',
          packId,
          { contactName: tenant.contact_name, email: tenant.email },
          mail.subject,
          mail.body,
        );
        await query(
          client,
          `update purchase_attempts set state = 'recorded', pack_id = $2 where id = $1`,
          [attempt.id, packId],
        );
        const pack = await packById(client, packId, now);
        if (pack === null) throw notFound();
        return { status: 201, body: await packView(client, pack) };
      });
      nudgeMailQueue();
      return reply;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(503, 'purchase_pending', serverMessage.purchasePending);
    }
  },
};

async function packOr404(ctx: Ctx, client: Db): Promise<void> {
  const pack = await queryOne<{ tenant_id: string }>(client, 'select tenant_id from packs where id = $1', [
    ctx.params.id ?? '',
  ]);
  if (pack === null) throw notFound();
  if (ctx.user?.role === 'tenant' && pack.tenant_id !== ctx.user.tenantId) throw notFound();
}

const packDetail: Route = {
  method: 'GET',
  pattern: '/api/packs/:id',
  roles: ['owner', 'tenant'],
  resolve: packOr404,
  handler: async (ctx: Ctx): Promise<Reply> =>
    withTransaction(async (client) => {
      const now = await transactionNow(client);
      const pack = await packById(client, ctx.params.id ?? '', now);
      if (pack === null) throw notFound();
      if (ctx.user?.role === 'tenant' && pack.row.tenant_id !== ctx.user.tenantId) throw notFound();
      return { status: 200, body: await packDetailView(client, pack) };
    }),
};

const refund: Route = {
  method: 'POST',
  pattern: '/api/packs/:id/refund',
  roles: ['owner'],
  bodyFields: ['expectedCents'],
  resolve: packOr404,
  reauth: () => true,
  handler: async (ctx: Ctx): Promise<Reply> => {
    const expectedCents = ctx.body.expectedCents;
    const fields: Record<string, string> = {};
    if (typeof expectedCents !== 'number' || !Number.isInteger(expectedCents) || expectedCents < 0) {
      fields.expectedCents = serverMessage.expectedCents;
    }
    finishValidation(ctx, fields);

    return withTransaction(async (client) => {
      const now = await transactionNow(client);
      const pack = await lockPack(client, ctx.params.id ?? '', now);
      if (pack === null) throw notFound();

      if (pack.row.status === 'refunded') {
        throw conflict('invalid_transition', serverMessage.invalidTransition);
      }
      if (pack.balanceMinutes === 0) {
        throw conflict('pack_empty', serverMessage.packEmpty);
      }
      const inUse = await queryOne<{ count: string }>(
        client,
        `select count(*)::text as count from bookings
         where pack_id = $1 and status in ('confirmed','checked_in')`,
        [pack.row.id],
      );
      if (pack.heldMinutes > 0 || Number(inUse?.count ?? '0') > 0) {
        throw conflict('pack_in_use', serverMessage.packInUse);
      }
      const amountCents = refundableCentsOf(pack);
      if (expectedCents !== amountCents) {
        throw new ApiError(412, 'refund_amount_changed', serverMessage.refundAmountChanged);
      }
      const paymentId = pack.row.killbill_payment_id;
      if (paymentId === null) throw billingUnavailable(serverMessage.billingUnavailableRefund);
      try {
        await refundPayment(paymentId, amountCents, `stationhouse-refund-${pack.row.id}`);
      } catch (error) {
        if (error instanceof BillingUnavailableError) {
          throw billingUnavailable(serverMessage.billingUnavailableRefund);
        }
        throw error;
      }
      await writeMovement(client, pack.row.id, 'refund', -pack.balanceMinutes, null);
      await query(client, `update packs set status = 'refunded', refunded_cents = $2 where id = $1`, [
        pack.row.id,
        amountCents,
      ]);
      const refunded = await packById(client, pack.row.id, now);
      if (refunded === null) throw notFound();
      return { status: 200, body: await packDetailView(client, refunded) };
    });
  },
};

export const packRoutes: ReadonlyArray<Route> = [listPacks, buyPack, packDetail, refund];
