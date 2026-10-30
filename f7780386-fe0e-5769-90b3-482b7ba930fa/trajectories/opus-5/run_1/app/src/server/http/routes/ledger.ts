import type { LedgerTransaction } from '../../../shared/api.js';
import { accountIdFor, chargeAndPay } from '../../domain/billing.js';
import { enqueueEmail, invoiceNoticeEmail } from '../../domain/emails.js';
import { findMember, listPacks } from '../../domain/kitchen.js';
import {
  balanceMinutes,
  listTransactions,
  loadTransaction,
  recordTransaction,
} from '../../domain/ledger.js';
import { requireUser, type RequestContext } from '../context.js';
import { conflict, invalidField, notFound, validationFailed } from '../errors.js';
import { route, type Route } from '../router.js';
import { queryString, requireBoundedText, requireInteger, requireString } from '../validate.js';

/** Members read their own ledger; the operator must name a member. */
function ledgerMemberId(ctx: RequestContext): string {
  const user = requireUser(ctx);
  const asked = queryString(ctx.req.query['member_id']);
  if (user.role === 'operator') {
    if (asked === null) throw validationFailed({ member_id: 'required' });
    return asked;
  }
  if (user.member_id === null) throw notFound();
  if (asked !== null && asked !== user.member_id) throw notFound();
  return user.member_id;
}

export const ledgerRoutes: Route[] = [
  route({
    method: 'GET',
    path: '/ledger',
    handle: async (ctx) => {
      const memberId = ledgerMemberId(ctx);
      if ((await findMember(ctx.app.db, memberId)) === null) throw notFound();
      const transactions: LedgerTransaction[] = await listTransactions(
        ctx.app.db,
        memberId,
        ctx.app.config.timeZone,
      );
      return {
        status: 200,
        body: {
          member_id: memberId,
          balance_minutes: await balanceMinutes(ctx.app.db, memberId),
          transactions,
        },
      };
    },
  }),

  route({
    method: 'POST',
    path: '/packs/:pack_id/purchase',
    roles: ['member'],
    resolve: async (ctx) => {
      const packs = await listPacks(ctx.app.db);
      const pack = packs.find((candidate) => candidate.id === ctx.req.params['pack_id']);
      if (pack === undefined) throw notFound();
      return pack;
    },
    handle: async (ctx, pack) => {
      const user = requireUser(ctx);
      const memberId = user.member_id as string;

      const result = await ctx.app.db.transaction(async (client) => {
        // Hours are credited only after Kill Bill records the pack's payment.
        const invoiceId = await chargeAndPay(client, ctx.app, memberId, pack.name, pack.price_cents);
        const transactionId = await recordTransaction(client, {
          memberId,
          kind: 'pack_purchase',
          minutes: pack.minutes,
          createdAt: ctx.now,
        });
        const notice = invoiceNoticeEmail({
          chargeKey: `pack:${transactionId}`,
          description: pack.name,
          amountCents: pack.price_cents,
        });
        const member = await findMember(client, memberId);
        await enqueueEmail(
          client,
          notice.dedupeKey,
          member?.contact_email ?? '',
          notice.subject,
          notice.body,
          ctx.now,
        );
        return { transactionId, invoiceId };
      });
      ctx.app.billing.markUp();

      const transaction = await loadTransaction(
        ctx.app.db,
        result.transactionId,
        ctx.app.config.timeZone,
      );
      return {
        status: 201,
        body: {
          transaction,
          balance_minutes: await balanceMinutes(ctx.app.db, memberId),
          invoice_id: result.invoiceId,
        },
      };
    },
  }),

  route({
    method: 'POST',
    path: '/ledger/adjustments',
    roles: ['operator'],
    handle: async (ctx) => {
      const memberId = requireString(ctx.body, 'member_id');
      const minutes = requireInteger(ctx.body, 'minutes');
      if (minutes === 0 || minutes % 15 !== 0 || minutes < -6000 || minutes > 6000) {
        throw invalidField('minutes', 'invalid');
      }
      const reason = requireBoundedText(ctx.body, 'reason', 1, 200);
      if ((await findMember(ctx.app.db, memberId)) === null) throw notFound();

      const transactionId = await ctx.app.db.transaction(async (client) => {
        const balance = await balanceMinutes(client, memberId);
        if (balance + minutes < 0) throw conflict('insufficient_hours');
        return recordTransaction(client, {
          memberId,
          kind: 'adjustment',
          minutes,
          createdAt: ctx.now,
          reason,
        });
      });

      return {
        status: 201,
        body: {
          transaction: await loadTransaction(ctx.app.db, transactionId, ctx.app.config.timeZone),
          balance_minutes: await balanceMinutes(ctx.app.db, memberId),
        },
      };
    },
  }),

  route({
    method: 'POST',
    path: '/ledger/transactions/:id/reverse',
    roles: ['operator'],
    resolve: async (ctx) => {
      const found = await ctx.app.db.query<{
        id: string;
        member_id: string;
        kind: string;
        reversed_by: string | null;
      }>('SELECT id, member_id, kind, reversed_by FROM ledger_transactions WHERE id = $1', [
        ctx.req.params['id'],
      ]);
      const original = found.rows[0];
      if (original === undefined) throw notFound();
      return original;
    },
    handle: async (ctx, original) => {
      const reason = requireBoundedText(ctx.body, 'reason', 1, 200);
      if (original.reversed_by !== null) throw conflict('already_reversed');
      if (original.kind !== 'adjustment' && original.kind !== 'opening') {
        throw conflict('not_reversible');
      }

      const transactionId = await ctx.app.db.transaction(async (client) => {
        const locked = await client.query<{ reversed_by: string | null; minutes: number }>(
          `SELECT t.reversed_by,
                  COALESCE((SELECT SUM(e.minutes)::int FROM ledger_entries e
                             WHERE e.transaction_id = t.id
                               AND e.account = 'member:' || t.member_id), 0) AS minutes
             FROM ledger_transactions t WHERE t.id = $1 FOR UPDATE`,
          [original.id],
        );
        const row = locked.rows[0];
        if (row === undefined) throw notFound();
        if (row.reversed_by !== null) throw conflict('already_reversed');

        const balance = await balanceMinutes(client, original.member_id);
        if (balance - row.minutes < 0) throw conflict('insufficient_hours');

        return recordTransaction(client, {
          memberId: original.member_id,
          kind: 'reversal',
          minutes: -row.minutes,
          createdAt: ctx.now,
          reason,
          reverses: original.id,
        });
      });

      return {
        status: 201,
        body: {
          transaction: await loadTransaction(ctx.app.db, transactionId, ctx.app.config.timeZone),
          balance_minutes: await balanceMinutes(ctx.app.db, original.member_id),
        },
      };
    },
  }),

  route({
    method: 'GET',
    path: '/invoices',
    handle: async (ctx) => {
      const memberId = ledgerMemberId(ctx);
      if ((await findMember(ctx.app.db, memberId)) === null) throw notFound();
      const accountId = await accountIdFor(ctx.app.db, ctx.app, memberId);
      const invoices = await ctx.app.killBill.listInvoices(accountId);
      ctx.app.billing.markUp();
      return { status: 200, body: { invoices } };
    },
  }),

  route({
    method: 'GET',
    path: '/invoices/:id',
    handle: async (ctx) => {
      const user = requireUser(ctx);
      const memberId = user.role === 'operator' ? ledgerMemberId(ctx) : (user.member_id as string);
      const accountId = await accountIdFor(ctx.app.db, ctx.app, memberId);
      const invoices = await ctx.app.killBill.listInvoices(accountId);
      ctx.app.billing.markUp();
      const invoice = invoices.find((candidate) => candidate.id === ctx.req.params['id']);
      if (invoice === undefined) throw notFound();
      return { status: 200, body: { invoice } };
    },
  }),
];
