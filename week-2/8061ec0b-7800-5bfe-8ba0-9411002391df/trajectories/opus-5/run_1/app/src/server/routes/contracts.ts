import { Router, type Response } from 'express';
import { now, storeToday } from '../clock';
import { pool, withAdvisoryLock } from '../db';
import { conflict, gone, notFound, validationFailed } from '../errors';
import { param, route } from '../http';
import { contractMonthOf } from '../../shared/money';
import { isoMillis, isoSeconds } from '../../shared/time';
import { instrumentLabel } from '../../shared/labels';
import type { Contract, User } from '../../shared/types';
import {
  activateContract,
  beginIdempotent,
  buyoutContract,
  closeContract,
  createReservation,
  exchangeSize,
  loadActionContext,
  parentOf,
  recordPayment,
  revokeSigningLink,
  reversePayment,
  sendSigningLink,
  signAgreement,
  type ActionContext,
} from '../domain/actions';
import {
  buildContract,
  contractSummary,
  equityEntries,
  equityOf,
  loadAllContractRows,
  loadContractRow,
  loadContractRowsByStudents,
  nextBillingDate,
  termsOf,
  upcomingBillingDates,
} from '../domain/contracts';
import { buildInvoice, computeQuote, priceListInForce } from '../domain/pricing';
import type { IdempotencyState } from '../domain/idempotency';
import { visibleContractRow } from './access';

export const contractsRouter = Router();

contractsRouter.post(
  '/reservations',
  route(['parent'], async ({ user, body }) => ({ status: 201, body: { contract: await createReservation(user!, body) } })),
);

contractsRouter.get(
  '/contracts',
  route(['owner', 'tech', 'parent'], async ({ user }) => {
    const rows =
      user!.role === 'parent'
        ? await (async () => {
            const { rows: students } = await pool.query<{ id: string }>(
              'select id from students where family_id = $1',
              [user!.family_id],
            );
            return loadContractRowsByStudents(pool, students.map((student) => student.id));
          })()
        : await loadAllContractRows(pool);
    return { body: { contracts: await Promise.all(rows.map((row) => contractSummary(pool, row))) } };
  }),
);

contractsRouter.get(
  '/contracts/:id',
  route(['owner', 'tech', 'parent'], async ({ user, req }) => {
    const row = await visibleContractRow(pool, user!, param(req, 'id'));
    return { body: { contract: await buildContract(pool, row) } };
  }),
);

contractsRouter.get(
  '/contracts/:id/invoice',
  route(['owner', 'parent'], async ({ user, req }) => {
    const row = await visibleContractRow(pool, user!, param(req, 'id'));
    const today = storeToday();
    const terms = await termsOf(pool, row, today);
    const active = row.status === 'active' && row.billing_anchor_date !== null;
    const billingDate = active ? nextBillingDate(row.billing_anchor_date!, today) : null;
    const upcoming = active ? upcomingBillingDates(row.billing_anchor_date!, today, 4) : [];
    const rateList = await priceListInForce(pool, billingDate ?? today);
    if (rateList === null) throw notFound();
    return {
      body: {
        invoice: buildInvoice(row.id, terms, row.waiver, billingDate, upcoming, rateList.tax_rate_bp),
      },
    };
  }),
);

contractsRouter.get(
  '/contracts/:id/equity',
  route(['owner', 'parent'], async ({ user, req }) => {
    const row = await visibleContractRow(pool, user!, param(req, 'id'));
    const terms = await termsOf(pool, row, storeToday());
    const equity = await equityOf(pool, row.id);
    const terminal = !['reserved', 'agreement_sent', 'signed', 'active'].includes(row.status);
    return {
      body: {
        equity_cents: equity,
        purchase_price_cents: terms.purchase_price_cents,
        contract_month: contractMonthOf(equity, terms.base_rent_cents),
        closed: terminal,
        entries: await equityEntries(pool, row.id),
      },
    };
  }),
);

contractsRouter.get(
  '/contracts/:id/payments',
  route(['owner', 'parent'], async ({ user, req }) => {
    const row = await visibleContractRow(pool, user!, param(req, 'id'));
    const { rows } = await pool.query<{
      id: string;
      amount_cents: number;
      base_rent_cents: number;
      waiver_cents: number;
      tax_cents: number;
      killbill_payment_id: string;
      created_at: Date;
    }>(
      `select id, amount_cents, base_rent_cents, waiver_cents, tax_cents, killbill_payment_id, created_at
         from payments where contract_id = $1 order by created_at, seq`,
      [row.id],
    );
    return {
      body: {
        payments: rows.map((payment) => ({ ...payment, created_at: isoSeconds(payment.created_at) })),
      },
    };
  }),
);

async function quoteContext(user: User, contractId: string) {
  const row = await visibleContractRow(pool, user, contractId);
  if (row.status !== 'signed' && row.status !== 'active') {
    throw conflict('no_quote', 'This contract has no payoff quote.');
  }
  const today = storeToday();
  const terms = await termsOf(pool, row, today);
  const equity = await equityOf(pool, row.id);
  return { row, terms, equity, today, month: contractMonthOf(equity, terms.base_rent_cents) };
}

contractsRouter.get(
  '/contracts/:id/quote',
  route(['owner', 'parent'], async ({ user, req }) => {
    const context = await quoteContext(user!, param(req, 'id'));
    const raw = req.query.month;
    const month = Number(raw);
    if (typeof raw !== 'string' || !Number.isInteger(month) || month < 0 || month > context.terms.term_months) {
      throw validationFailed({ month: `Choose a month from 0 to ${context.terms.term_months}.` });
    }
    return {
      body: {
        quote: computeQuote(context.row.id, context.terms, context.equity, context.month, month, context.today),
      },
    };
  }),
);

contractsRouter.get(
  '/contracts/:id/quotes',
  route(['owner', 'parent'], async ({ user, req }) => {
    const context = await quoteContext(user!, param(req, 'id'));
    const quotes = [];
    for (let month = 0; month <= context.terms.term_months; month += 1) {
      quotes.push(computeQuote(context.row.id, context.terms, context.equity, context.month, month, context.today));
    }
    return { body: { quotes } };
  }),
);

async function contractAction(
  user: User,
  contractId: string,
  run: (context: ActionContext) => Promise<Contract>,
): Promise<{ status?: number; body: unknown }> {
  const row = await visibleContractRow(pool, user, contractId);
  return withAdvisoryLock(`contract:${row.id}`, async () => {
    const context = await loadActionContext(pool, row.id);
    return { body: { contract: await run(context) } };
  });
}

contractsRouter.post(
  '/contracts/:id/signing-link',
  route(['owner'], async ({ user, req }) => {
    const answer = await contractAction(user!, param(req, 'id'), (context) => sendSigningLink(user!, context));
    return { status: 201, body: answer.body };
  }),
);

contractsRouter.post(
  '/contracts/:id/signing-link/revoke',
  route(['owner'], async ({ user, req }) => contractAction(user!, param(req, 'id'), (context) => revokeSigningLink(context))),
);

contractsRouter.post(
  '/contracts/:id/activate',
  route(['owner'], async ({ user, req }) =>
    contractAction(user!, param(req, 'id'), (context) => activateContract(user!, context)),
  ),
);

contractsRouter.post(
  '/contracts/:id/return',
  route(['owner'], async ({ user, req }) =>
    contractAction(user!, param(req, 'id'), (context) => closeContract(user!, context, 'returned')),
  ),
);

contractsRouter.post(
  '/contracts/:id/write-off',
  route(['owner'], async ({ user, req }) =>
    contractAction(user!, param(req, 'id'), (context) => closeContract(user!, context, 'written_off')),
  ),
);

async function idempotentAction<T>(
  user: User,
  contractId: string,
  endpoint: 'payments' | 'reversal' | 'buyout' | 'exchange',
  headerKey: unknown,
  bodyParts: unknown,
  successStatus: number,
  res: Response,
  run: (context: ActionContext, state: IdempotencyState, hash: string) => Promise<T>,
): Promise<{ status: number; body: unknown } | undefined> {
  const row = await visibleContractRow(pool, user, contractId);
  return withAdvisoryLock(`contract:${row.id}`, async () => {
    const { replay, state, hash } = await beginIdempotent(row.id, endpoint, headerKey, bodyParts);
    if (replay !== null) {
      res.status(replay.status).type('application/json; charset=utf-8').send(replay.body);
      return undefined;
    }
    const context = await loadActionContext(pool, row.id);
    const result = await run(context, state, hash);
    return { status: successStatus, body: result };
  });
}

contractsRouter.post(
  '/contracts/:id/payments',
  route(['owner'], async ({ user, req, body, res }) =>
    idempotentAction(
      user!,
      param(req, 'id'),
      'payments',
      req.headers['idempotency-key'],
      body,
      201,
      res,
      (context, state, hash) => recordPayment(user!, context, body, state, hash),
    ),
  ),
);

contractsRouter.post(
  '/contracts/:id/payments/:paymentId/reversal',
  route(['owner'], async ({ user, req, body, res }) => {
    const paymentId = param(req, 'paymentId');
    return idempotentAction(
      user!,
      param(req, 'id'),
      'reversal',
      req.headers['idempotency-key'],
      { paymentId, body },
      201,
      res,
      (context, state, hash) => reversePayment(context, paymentId, body, state, hash),
    );
  }),
);

contractsRouter.post(
  '/contracts/:id/buyout',
  route(['owner', 'parent'], async ({ user, req, body, res }) =>
    idempotentAction(
      user!,
      param(req, 'id'),
      'buyout',
      req.headers['idempotency-key'],
      body,
      200,
      res,
      (context, state, hash) => buyoutContract(user!, context, body, state, hash),
    ),
  ),
);

contractsRouter.post(
  '/contracts/:id/exchange',
  route(['owner'], async ({ user, req, body, res }) =>
    idempotentAction(
      user!,
      param(req, 'id'),
      'exchange',
      req.headers['idempotency-key'],
      body,
      201,
      res,
      (context, state, hash) => exchangeSize(user!, context, body, state, hash),
    ),
  ),
);

interface SigningLinkLookup {
  token: string;
  contract_id: string;
  expires_at: Date;
  status: 'live' | 'revoked' | 'used';
  newest_token: string;
}

async function signingLink(token: string): Promise<SigningLinkLookup> {
  const { rows } = await pool.query<SigningLinkLookup>(
    `select l.token, l.contract_id, l.expires_at, l.status,
            (select token from signing_links n where n.contract_id = l.contract_id order by n.seq desc limit 1) as newest_token
       from signing_links l where l.token = $1`,
    [token],
  );
  const link = rows[0];
  if (link === undefined || link.status === 'revoked' || link.newest_token !== link.token) {
    throw notFound('link_not_found');
  }
  if (link.status === 'used') throw gone('link_used');
  if (now().getTime() >= link.expires_at.getTime()) throw gone('link_expired');
  return link;
}

contractsRouter.get(
  '/signing/:token',
  route('anyone', async ({ req }) => {
    const link = await signingLink(param(req, 'token'));
    const row = await loadContractRow(pool, link.contract_id);
    if (row === null) throw notFound('link_not_found');
    const today = storeToday();
    const terms = await termsOf(pool, row, today);
    return {
      body: {
        server_now: isoMillis(now()),
        agreement: {
          contract_id: row.id,
          student_name: row.student_name,
          school_name: row.school_name,
          instrument_label: instrumentLabel(row.instrument_type, row.size),
          serial: row.serial,
          waiver: row.waiver,
          terms,
          link_expires_at: isoSeconds(link.expires_at),
          status: 'agreement_sent',
        },
      },
    };
  }),
);

contractsRouter.post(
  '/signing/:token',
  route('anyone', async ({ req, body }) => {
    const token = param(req, 'token');
    const link = await signingLink(token);
    return withAdvisoryLock(`contract:${link.contract_id}`, async () => {
      const fresh = await signingLink(token);
      const row = await loadContractRow(pool, fresh.contract_id);
      if (row === null) throw notFound('link_not_found');
      if (row.status === 'expired') throw gone('link_expired');
      if (row.status !== 'agreement_sent') throw gone('link_used');
      const raw = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
      const fields: Record<string, string> = {};
      const fullName = typeof raw.full_name === 'string' ? raw.full_name.trim() : '';
      if (fullName.length < 2 || fullName.length > 120) fields.full_name = 'Type your full legal name.';
      if (raw.agree !== true) fields.agree = 'Tick the box to agree.';
      if (Object.keys(fields).length > 0) throw validationFailed(fields);
      const today = storeToday();
      const context = {
        row,
        terms: await termsOf(pool, row, today),
        equity: await equityOf(pool, row.id),
        today,
        parent: await parentOf(pool, row.family_id),
      };
      return { body: { agreement: await signAgreement(token, context, fullName) } };
    });
  }),
);
