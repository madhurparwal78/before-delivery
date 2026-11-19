import { randomUUID } from 'node:crypto';
import { LOCK_MEMBER, inTransaction, lockAdvisory, pool } from '../db/pool.js';
import { ApiError, ValidationError } from '../http/errors.js';
import { json, memberRoute } from '../http/router.js';
import { CARD_CLEARING, memberAccount, postEntry } from '../domain/ledger.js';
import { formatAmount } from '../domain/money.js';
import { enqueue } from '../domain/queue.js';
import { formatInZone } from '../domain/time.js';
import { balanceOf, iso } from '../domain/views.js';
import { publishEffects } from '../publish.js';
import { newEffects } from '../domain/engine.js';
import { withIdempotency } from '../idempotency.js';
import {
  RANGES,
  asObject,
  digitsOfValidCard,
  onlyFields,
  readInteger,
  readString,
} from '../domain/validate.js';
import { killbillAccountKey } from '../billing.js';
import { ProviderUnreachable } from '../providers/http.js';
import * as killbill from '../providers/killbill.js';
import { presignGet, up as storageUp } from '../providers/s3.js';
import { documentKey, documentsUnavailable } from '../statements.js';
import { TRADING_ROLES, depositOfVenue, documentOfVenue, ownDeposit } from './common.js';
import type { DepositRow } from './common.js';
import type { Venue } from '../domain/types.js';
import type { Route } from '../http/router.js';

const paymentsUnavailable = (): ApiError => new ApiError(503, 'payments_unavailable');

interface DepositView {
  id: string;
  amount_cents: number;
  refunded_cents: number;
  status: string;
  card_last4: string;
  killbill_payment_id: string | null;
  created_at: string;
}

async function refundedCents(depositId: string): Promise<number> {
  const result = await pool.query<{ total: string | null }>(
    'select sum(amount_cents) as total from refunds where deposit_id = $1',
    [depositId],
  );
  return Number(result.rows[0]?.total ?? 0);
}

async function depositView(row: DepositRow): Promise<DepositView> {
  return {
    id: row.id,
    amount_cents: row.amount_cents,
    refunded_cents: await refundedCents(row.id),
    status: row.status,
    card_last4: row.card_last4,
    killbill_payment_id: row.killbill_payment_id,
    created_at: iso(row.created_at),
  };
}

/** The cap is the smaller of the deposit's unrefunded amount and the member's available balance. */
async function refundableCents(deposit: DepositRow): Promise<number> {
  const balance = await balanceOf(pool, deposit.member_id);
  return Math.min(deposit.amount_cents - (await refundedCents(deposit.id)), balance.available_cents);
}

export const depositRoutes: Route[] = [
  memberRoute(
    'POST',
    '/api/deposits',
    { venue: true, roles: TRADING_ROLES },
    async ({ actor, body, request }) => {
      const key = request.headers['idempotency-key'];
      const fields = asObject(body);
      return withIdempotency(
        actor.member.id,
        'POST /api/deposits',
        typeof key === 'string' ? key : undefined,
        fields,
        async () => {
          const venue = actor.venue as Venue;
          onlyFields(fields, ['amount_cents', 'card_number']);
          const amountCents = readInteger(fields, 'amount_cents');
          const cardNumber = readString(fields, 'card_number');
          const digits = digitsOfValidCard(cardNumber);
          const errors: Record<string, string> = {};
          if (amountCents < RANGES.depositAmountCents.min || amountCents > RANGES.depositAmountCents.max) {
            errors.amount_cents = 'out_of_range';
          }
          if (digits === null) errors.card_number = 'invalid';
          if (Object.keys(errors).length > 0) throw new ValidationError(errors);

          const last4 = (digits as string).slice(-4);
          const depositId = randomUUID();
          let purchase: killbill.PurchaseResult;
          try {
            const accountId = await killbill.ensureAccount(
              killbillAccountKey(venue.slug, actor.member.id),
              actor.member.display_name,
              actor.member.email,
              last4,
            );
            purchase = await killbill.purchase(
              accountId,
              `deposit-${depositId}`,
              amountCents,
              last4,
            );
          } catch (error) {
            if (error instanceof ProviderUnreachable) throw paymentsUnavailable();
            throw error;
          }

          const status = purchase.succeeded ? 'succeeded' : 'declined';
          const created = await inTransaction(async (client) => {
            const inserted = await client.query<DepositRow>(
              `insert into deposits (id, venue_id, member_id, amount_cents, status, card_last4, killbill_payment_id)
               values ($1,$2,$3,$4,$5,$6,$7)
               returning id, venue_id, member_id, amount_cents, status, card_last4, killbill_payment_id, created_at`,
              [depositId, venue.id, actor.member.id, amountCents, status, last4, purchase.paymentId],
            );
            const row = inserted.rows[0] as DepositRow;
            if (!purchase.succeeded) return row;

            await postEntry(client, venue.id, 'deposit', depositId, [
              { account: CARD_CLEARING, amount_cents: -amountCents },
              { account: memberAccount(actor.member.id, 'available'), amount_cents: amountCents },
            ]);
            const balance = await client.query<{ available_cents: number }>(
              'select available_cents from member_balances where member_id = $1',
              [actor.member.id],
            );
            await enqueue(client, 'email', `deposit:${depositId}`, {
              to: actor.member.email,
              subject: `Deposit received — ${formatAmount(amountCents)}`,
              body: [
                `Amount: ${formatAmount(amountCents)}`,
                `Card ending: ${last4}`,
                `Deposit id: ${depositId}`,
                `Time: ${formatInZone(venue.time_zone, row.created_at)}`,
                `New available balance: ${formatAmount(balance.rows[0]?.available_cents ?? 0)}`,
              ].join('\n'),
            });
            return row;
          });

          const effects = newEffects();
          effects.balances.add(actor.member.id);
          await publishEffects(effects);

          if (!purchase.succeeded) {
            throw new ApiError(402, 'payment_declined', { deposit_id: depositId });
          }
          return json(201, await depositView(created));
        },
      );
    },
  ),

  memberRoute('GET', '/api/deposits', { venue: true }, async ({ actor }) => {
    const result = await pool.query<DepositRow>(
      `select id, venue_id, member_id, amount_cents, status, card_last4, killbill_payment_id, created_at
         from deposits where member_id = $1 order by created_at desc`,
      [actor.member.id],
    );
    const deposits = [];
    for (const row of result.rows) deposits.push(await depositView(row));
    return json(200, { deposits });
  }),

  memberRoute('GET', '/api/deposits/:id', { resource: ownDeposit }, async ({ resource }) =>
    json(200, await depositView(resource)),
  ),

  memberRoute(
    'GET',
    '/api/admin/deposits',
    { venue: true, roles: ['market_admin'] },
    async ({ actor, url }) => {
      const venue = actor.venue as Venue;
      const query = url.searchParams.get('q');
      const result = await pool.query<DepositRow & { display_name: string; email: string }>(
        `select d.id, d.venue_id, d.member_id, d.amount_cents, d.status, d.card_last4,
                d.killbill_payment_id, d.created_at, m.display_name, m.email
           from deposits d join members m on m.id = d.member_id
          where d.venue_id = $1
            and ($2::text is null or m.display_name ilike '%' || $2 || '%' or m.email ilike '%' || $2 || '%')
          order by d.created_at desc`,
        [venue.id, query],
      );
      const deposits = [];
      for (const row of result.rows) {
        deposits.push({
          ...(await depositView(row)),
          member: { id: row.member_id, display_name: row.display_name, email: row.email },
        });
      }
      return json(200, { deposits });
    },
  ),

  memberRoute(
    'POST',
    '/api/deposits/:id/refunds',
    { venue: true, roles: ['market_admin'], resource: depositOfVenue },
    async ({ actor, resource, body }) => {
      const venue = actor.venue as Venue;
      const fields = asObject(body);
      onlyFields(fields, ['amount_cents']);
      const amountCents = readInteger(fields, 'amount_cents');
      if (resource.status !== 'succeeded' || resource.killbill_payment_id === null) {
        throw new ApiError(409, 'deposit_not_refundable');
      }
      if (amountCents < 1) throw new ValidationError({ amount_cents: 'invalid' });

      const refundId = randomUUID();
      const refund = await inTransaction(async (client) => {
        await lockAdvisory(client, LOCK_MEMBER, resource.member_id);
        const cap = await refundableCents(resource);
        if (amountCents > cap) throw new ValidationError({ amount_cents: 'exceeds_refundable' });

        let result: killbill.RefundResult;
        try {
          result = await killbill.refund(
            resource.killbill_payment_id as string,
            `refund-${refundId}`,
            amountCents,
          );
        } catch (error) {
          if (error instanceof ProviderUnreachable) throw paymentsUnavailable();
          throw error;
        }
        if (!result.succeeded) throw new ApiError(409, 'deposit_not_refundable');

        await client.query(
          `insert into refunds (id, venue_id, deposit_id, amount_cents, killbill_transaction_id)
           values ($1,$2,$3,$4,$5)`,
          [refundId, venue.id, resource.id, amountCents, result.transactionId],
        );
        await postEntry(client, venue.id, 'refund', refundId, [
          { account: memberAccount(resource.member_id, 'available'), amount_cents: -amountCents },
          { account: CARD_CLEARING, amount_cents: amountCents },
        ]);
        const owner = await client.query<{ email: string }>('select email from members where id = $1', [
          resource.member_id,
        ]);
        await enqueue(client, 'email', `refund:${refundId}`, {
          to: owner.rows[0]?.email ?? '',
          subject: `Refund issued — ${formatAmount(amountCents)}`,
          body: `A refund of ${formatAmount(amountCents)} was issued to the card ending ${resource.card_last4} for deposit ${resource.id}.`,
        });
        return {
          id: refundId,
          deposit_id: resource.id,
          amount_cents: amountCents,
          killbill_transaction_id: result.transactionId,
          created_at: iso(new Date()),
        };
      });

      const effects = newEffects();
      effects.balances.add(resource.member_id);
      await publishEffects(effects);
      return json(201, refund);
    },
  ),

  memberRoute('GET', '/api/admin/documents', { venue: true, roles: ['market_admin'] }, async ({ actor }) => {
    const venue = actor.venue as Venue;
    const result = await pool.query<{
      id: string;
      member_id: string;
      display_name: string;
      filename: string;
      content_type: string;
      size_bytes: number;
      uploaded_at: Date;
    }>(
      `select d.id, d.member_id, m.display_name, d.filename, d.content_type, d.size_bytes, d.uploaded_at
         from documents d join members m on m.id = d.member_id
        where d.venue_id = $1 order by d.uploaded_at desc`,
      [venue.id],
    );
    return json(200, {
      documents: result.rows.map((row) => ({
        id: row.id,
        member: { id: row.member_id, display_name: row.display_name },
        filename: row.filename,
        content_type: row.content_type,
        size_bytes: row.size_bytes,
        uploaded_at: iso(row.uploaded_at),
      })),
    });
  }),

  memberRoute(
    'GET',
    '/api/admin/documents/:id/link',
    { venue: true, roles: ['market_admin'], resource: documentOfVenue },
    async ({ resource }) => {
      if (!(await storageUp())) throw documentsUnavailable();
      const link = presignGet(documentKey(resource.venue_id, resource.member_id, resource.id));
      return json(200, { url: link.url, expires_at: iso(link.expiresAt) });
    },
  ),
];
