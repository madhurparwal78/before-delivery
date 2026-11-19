/** The published API: every method and path under /api, and nothing else. */
import { businessNow, newYorkDate } from "./clock.js";
import { snapshotRead, transaction } from "./db.js";
import { listAudit } from "./domain/audit.js";
import { createAccount, findAccount, listAccounts, readSnapshot, accountView } from "./domain/accounts.js";
import { approvePayment, cancelPayment, createPayment, getPayment, listApprovals, listPayments, readPaymentKeys, rejectPayment } from "./domain/payments.js";
import { endSession, findCompanyName, logIn, readLogIn, readSignUp, signUp, userView } from "./domain/auth.js";
import { createQuote } from "./domain/fx.js";
import { once } from "./domain/idempotency.js";
import { listInvoices, markPaid, requireInvoice, sendInvoice } from "./domain/invoices.js";
import { drawLoan, listLoans, requireLoan } from "./domain/loans.js";
import { attachmentHeader, listTransactions, search, statementFor, transactionsAfter } from "./domain/feed.js";
import { getRecipient, inviteRecipient, listRecipients, saveRecipient } from "./domain/recipients.js";
import { removeRecipient } from "./domain/recipient-removal.js";
import { createTransfer, readTransferKeys } from "./domain/transfers.js";
import { storeInquiry } from "./domain/inquiries.js";
import { closeSessionStreams, openStream, startLive } from "./domain/stream.js";
import { databaseState } from "./db.js";
import { ACCOUNT_KINDS, ACCOUNT_NAME_MAX, type AccountKind } from "../shared/rules.js";
import { Fields, forbidden, refusal } from "./http/errors.js";
import { jsonObject, optionalJsonObject, type Context } from "./http/context.js";
import { HANDLED, json, noContent, serialised, type Reply } from "./http/reply.js";
import type { Route } from "./http/router.js";
import { codePointLength, hasRefusedCharacter } from "./http/text.js";
import { settlementPreview } from "./settlement.js";

const owner = (ctx: Context) => ctx.user.role === "owner";
const ownerOrAdmin = (ctx: Context) => ctx.user.role !== "member";

function requireRole(allowed: boolean): void {
  if (!allowed) throw forbidden();
}

export function healthReply(): Reply {
  return databaseState.ready && databaseState.reachable ? json(200, { status: "ok" }) : json(503, { status: "unavailable" });
}

const wrap = (key: string, value: unknown) => json(200, { [key]: value });

export const routes: Route[] = [
  { method: "GET", path: "/api/health", auth: false, handle: async () => healthReply() },

  {
    method: "POST",
    path: "/api/auth/signup",
    auth: false,
    handle: async (ctx) => {
      const input = readSignUp(jsonObject(ctx));
      const { token, user } = await signUp(input);
      return json(201, { token, user: userView(user) });
    },
  },
  {
    method: "POST",
    path: "/api/auth/login",
    auth: false,
    handle: async (ctx) => {
      const { email, password } = readLogIn(jsonObject(ctx));
      const { token, user } = await logIn(email, password);
      return json(200, { token, user: userView(user) });
    },
  },
  {
    method: "POST",
    path: "/api/auth/logout",
    auth: true,
    handle: async (ctx) => {
      await endSession(ctx.user.sessionId);
      closeSessionStreams(ctx.user.sessionId);
      return noContent();
    },
  },
  {
    method: "GET",
    path: "/api/me",
    auth: true,
    handle: async (ctx) => {
      const now = businessNow();
      const preview = settlementPreview(now);
      const companyName = await findCompanyName(ctx.user.companyId);
      return json(200, {
        user: userView(ctx.user),
        company: { id: ctx.user.companyId, name: companyName },
        business_date: newYorkDate(now),
        business_now: now.toISOString(),
        settlement_dates: preview.settlementDates,
        settlement_dates_change_at: preview.changeAt.toISOString(),
      });
    },
  },

  {
    method: "GET",
    path: "/api/accounts",
    auth: true,
    handle: async (ctx) => wrap("accounts", await snapshotRead((tx) => listAccounts(tx, ctx.user.companyId))),
  },
  {
    method: "POST",
    path: "/api/accounts",
    auth: true,
    handle: async (ctx) => {
      requireRole(ownerOrAdmin(ctx));
      const body = jsonObject(ctx);
      const fields = new Fields();
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const length = codePointLength(name);
      if (length < 1 || length > ACCOUNT_NAME_MAX || hasRefusedCharacter(name, "single-line")) fields.fail("name", "Enter a name of up to 60 characters");
      const kind = ACCOUNT_KINDS.find((candidate) => candidate === body.kind);
      if (!kind) fields.fail("kind", "Choose checking, savings or treasury");
      fields.raise();
      const created = await transaction((tx) => createAccount(tx, ctx.user.companyId, name, kind as AccountKind, businessNow()));
      return json(201, created);
    },
  },
  {
    method: "GET",
    path: "/api/accounts/:account_id",
    auth: true,
    handle: async (ctx) =>
      snapshotRead(async (tx) => {
        const account = await findAccount(tx, ctx.user.companyId, ctx.params.account_id);
        const recent = await listTransactions(tx, ctx.user.companyId, new URLSearchParams({ account_id: account.id, limit: "10" }));
        return json(200, { account: accountView(account), recent_transactions: recent.transactions });
      }),
  },
  {
    method: "GET",
    path: "/api/accounts/:account_id/statement.csv",
    auth: true,
    handle: async (ctx) =>
      snapshotRead(async (tx) => {
        const account = await findAccount(tx, ctx.user.companyId, ctx.params.account_id);
        const statement = await statementFor(tx, account, ctx.query.get("month"), businessNow());
        return {
          status: 200,
          body: statement.csv,
          contentType: "text/csv; charset=utf-8",
          headers: { "Content-Disposition": attachmentHeader(statement.fileName) },
        };
      }),
  },
  {
    method: "GET",
    path: "/api/snapshot",
    auth: true,
    handle: async (ctx) => json(200, await snapshotRead((tx) => readSnapshot(tx, ctx.user.companyId, businessNow()))),
  },

  {
    method: "GET",
    path: "/api/transactions",
    auth: true,
    handle: async (ctx) => json(200, await snapshotRead((tx) => listTransactions(tx, ctx.user.companyId, ctx.query))),
  },
  {
    method: "GET",
    path: "/api/search",
    auth: true,
    handle: async (ctx) => json(200, await snapshotRead((tx) => search(tx, ctx.user.companyId, ctx.query.get("q")))),
  },
  {
    method: "GET",
    path: "/api/stream",
    auth: true,
    tokenInQuery: true,
    handle: async (ctx) => {
      const subscriber = openStream(ctx.user.companyId, ctx.user.sessionId, ctx.res);
      const lastEventId = ctx.query.get("last_event_id") ?? (typeof ctx.req.headers["last-event-id"] === "string" ? ctx.req.headers["last-event-id"] : null);
      const replay = lastEventId ? await snapshotRead((tx) => transactionsAfter(tx, ctx.user.companyId, lastEventId)) : [];
      startLive(subscriber, replay);
      return HANDLED;
    },
  },

  {
    method: "GET",
    path: "/api/recipients",
    auth: true,
    handle: async (ctx) => wrap("recipients", await snapshotRead((tx) => listRecipients(tx, ctx.user.companyId))),
  },
  {
    method: "POST",
    path: "/api/recipients",
    auth: true,
    handle: async (ctx) => json(201, await saveRecipient(ctx.user, jsonObject(ctx), businessNow())),
  },
  {
    method: "POST",
    path: "/api/recipients/invite",
    auth: true,
    handle: async (ctx) => json(201, await inviteRecipient(ctx.user, jsonObject(ctx), businessNow())),
  },
  {
    method: "GET",
    path: "/api/recipients/:recipient_id",
    auth: true,
    handle: async (ctx) => json(200, await snapshotRead((tx) => getRecipient(tx, ctx.user.companyId, ctx.params.recipient_id))),
  },
  {
    method: "DELETE",
    path: "/api/recipients/:recipient_id",
    auth: true,
    handle: async (ctx) => {
      await removeRecipient(ctx.user, ctx.params.recipient_id, businessNow());
      return noContent();
    },
  },

  {
    method: "POST",
    path: "/api/payments",
    auth: true,
    handle: async (ctx) => {
      const input = readPaymentKeys(jsonObject(ctx));
      const now = businessNow();
      const outcome = await transaction((tx) =>
        once(tx, { companyId: ctx.user.companyId, endpoint: "POST /api/payments", key: ctx.idempotencyKey, read: { ...input }, now }, async () => ({
          status: 201,
          body: await createPayment(tx, ctx.user, input, now),
        })),
      );
      return serialised(outcome.status, outcome.body);
    },
  },
  {
    method: "GET",
    path: "/api/payments",
    auth: true,
    handle: async (ctx) => wrap("payments", await snapshotRead((tx) => listPayments(tx, ctx.user.companyId))),
  },
  {
    method: "GET",
    path: "/api/payments/:payment_id",
    auth: true,
    handle: async (ctx) => json(200, await snapshotRead((tx) => getPayment(tx, ctx.user.companyId, ctx.params.payment_id))),
  },
  {
    method: "POST",
    path: "/api/payments/:payment_id/cancel",
    auth: true,
    handle: async (ctx) => {
      const result = await transaction((tx) => cancelPayment(tx, ctx.user, ctx.params.payment_id));
      if ("refused" in result) throw refusal(409, result.refused);
      return json(200, result);
    },
  },
  {
    method: "POST",
    path: "/api/payments/:payment_id/approve",
    auth: true,
    handle: async (ctx) => {
      const decision = await transaction((tx) => approvePayment(tx, ctx.user, ctx.params.payment_id, businessNow()));
      if ("refused" in decision) throw refusal(409, decision.refused);
      return json(200, decision.payment);
    },
  },
  {
    method: "POST",
    path: "/api/payments/:payment_id/reject",
    auth: true,
    handle: async (ctx) => {
      const decision = await transaction((tx) => rejectPayment(tx, ctx.user, ctx.params.payment_id, businessNow()));
      if ("refused" in decision) throw refusal(409, decision.refused);
      return json(200, decision.payment);
    },
  },
  {
    method: "GET",
    path: "/api/approvals",
    auth: true,
    handle: async (ctx) => wrap("approvals", await snapshotRead((tx) => listApprovals(tx, ctx.user.companyId))),
  },
  {
    method: "POST",
    path: "/api/fx/quotes",
    auth: true,
    handle: async (ctx) => json(201, await transaction((tx) => createQuote(tx, ctx.user.companyId, jsonObject(ctx), businessNow()))),
  },

  {
    method: "GET",
    path: "/api/invoices",
    auth: true,
    handle: async (ctx) => wrap("invoices", await snapshotRead((tx) => listInvoices(tx, ctx.user.companyId))),
  },
  {
    method: "POST",
    path: "/api/invoices/:invoice_id/send",
    auth: true,
    handle: async (ctx) =>
      json(
        200,
        await transaction(async (tx) => {
          await requireInvoice(tx, ctx.user.companyId, ctx.params.invoice_id);
          requireRole(ownerOrAdmin(ctx));
          return sendInvoice(tx, ctx.user, ctx.params.invoice_id);
        }),
      ),
  },
  {
    method: "POST",
    path: "/api/invoices/:invoice_id/mark-paid",
    auth: true,
    handle: async (ctx) =>
      json(
        200,
        await transaction(async (tx) => {
          await requireInvoice(tx, ctx.user.companyId, ctx.params.invoice_id);
          requireRole(ownerOrAdmin(ctx));
          const body = jsonObject(ctx);
          return markPaid(tx, ctx.user, ctx.params.invoice_id, body.account_id, businessNow());
        }),
      ),
  },
  {
    method: "GET",
    path: "/api/loans",
    auth: true,
    handle: async (ctx) => wrap("loans", await snapshotRead((tx) => listLoans(tx, ctx.user.companyId))),
  },
  {
    method: "POST",
    path: "/api/loans/:loan_id/draw",
    auth: true,
    handle: async (ctx) => {
      const now = businessNow();
      const outcome = await transaction(async (tx) => {
        await requireLoan(tx, ctx.user.companyId, ctx.params.loan_id);
        requireRole(owner(ctx));
        const body = jsonObject(ctx);
        return once(
          tx,
          { companyId: ctx.user.companyId, endpoint: `POST /api/loans/${ctx.params.loan_id}/draw`, key: ctx.idempotencyKey, read: { amount_cents: body.amount_cents }, now },
          async () => ({ status: 200, body: await drawLoan(tx, ctx.user, ctx.params.loan_id, body.amount_cents, now) }),
        );
      });
      return serialised(outcome.status, outcome.body);
    },
  },
  {
    method: "POST",
    path: "/api/transfers",
    auth: true,
    handle: async (ctx) => {
      const input = readTransferKeys(jsonObject(ctx));
      const now = businessNow();
      const outcome = await transaction((tx) =>
        once(tx, { companyId: ctx.user.companyId, endpoint: "POST /api/transfers", key: ctx.idempotencyKey, read: { ...input }, now }, async () => ({
          status: 201,
          body: await createTransfer(tx, ctx.user, input, now),
        })),
      );
      return serialised(outcome.status, outcome.body);
    },
  },

  {
    method: "GET",
    path: "/api/audit",
    auth: true,
    handle: async (ctx) => {
      requireRole(ownerOrAdmin(ctx));
      return wrap("events", await snapshotRead((tx) => listAudit(tx, ctx.user.companyId)));
    },
  },
  {
    method: "GET",
    path: "/api/plans",
    auth: false,
    handle: async () =>
      wrap(
        "plans",
        await snapshotRead(async (tx) => {
          const found = await tx.query("SELECT id, name, monthly_cents, annual_cents, features FROM plans ORDER BY monthly_cents");
          return found.rows;
        }),
      ),
  },
  {
    method: "POST",
    path: "/api/inquiries",
    auth: false,
    handle: async (ctx) => json(201, await storeInquiry(optionalJsonObject(ctx), businessNow())),
  },
];

