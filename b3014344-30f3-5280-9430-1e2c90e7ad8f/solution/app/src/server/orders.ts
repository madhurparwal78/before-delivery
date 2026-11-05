import { randomUUID } from "node:crypto";
import { emailTaken, hashPassword, signIn, toUser, validEmail, type Session } from "./auth";
import { approves, declined, readCard } from "./cards";
import { query, rows, tx, type Db, type Row } from "./db";
import { errors, HttpError, record } from "./http";
import * as billing from "./killbill";
import { enqueue, messages, type ReceiptKind } from "./mail";
import { SEED_PRICES } from "./catalog";
import { figuresFor, priceAt } from "./pricing";
import { deleteObject, objectKeys, putObject } from "./storage";
import { studioInstant } from "./time";
import { COPY, copyFor } from "../shared/copy";
import { careTier, isCare, isPlanId, PLAN_NAMES, type Order, type OrderState, type PaymentKind, type PlanId, type User } from "../shared/domain";
import { isCurrency, parseAmount, toAmount, formatMoney, type Currency } from "../shared/money";

export interface OrderRow extends Row {
  id: string;
  number: string;
  creator_key: string | null;
  account_id: string | null;
  plan: PlanId;
  currency: Currency;
  state: OrderState;
  total_minor: string;
  due_now_minor: string;
  due_at_launch_minor: string;
  price_id: string;
  accepted_at: Date | null;
  balance_invoice_id: string | null;
  project_id: string | null;
  business_name: string | null;
}

interface PaymentRow extends Row {
  id: string;
  order_id: string;
  kind: PaymentKind | "change" | "renewal";
  amount_minor: string;
  kb_payment_ids: string[];
  kb_invoice_id: string;
  captured_at: Date;
  refunded_minor: string;
}

const ORDER_SELECT = `SELECT o.*, p.id AS project_id, a.business_name
  FROM orders o LEFT JOIN projects p ON p.order_id = o.id LEFT JOIN client_accounts a ON a.id = o.account_id`;

async function paymentsOf(db: Db | null, orderIds: string[]): Promise<PaymentRow[]> {
  const sql = `SELECT pay.*, COALESCE((SELECT sum(r.amount_minor) FROM refunds r WHERE r.payment_id = pay.id), 0) AS refunded_minor
               FROM payments pay WHERE pay.order_id = ANY($1) AND pay.kind IN ('deposit', 'balance', 'care') ORDER BY pay.captured_at`;
  return db ? rows<PaymentRow>(db, sql, [orderIds]) : query<PaymentRow>(sql, [orderIds]);
}

function orderBody(row: OrderRow, payments: PaymentRow[], withBusiness = false): Order {
  return {
    id: row.id,
    number: row.number,
    accountId: row.account_id,
    plan: row.plan,
    planName: PLAN_NAMES[row.plan],
    currency: row.currency,
    state: row.state,
    total: toAmount(BigInt(row.total_minor)),
    dueNow: toAmount(BigInt(row.due_now_minor)),
    dueAtLaunch: toAmount(BigInt(row.due_at_launch_minor)),
    acceptedAt: row.accepted_at ? studioInstant(row.accepted_at) : null,
    projectId: row.project_id,
    payments: payments
      .filter((p) => p.order_id === row.id)
      .map((p) => ({
        kind: p.kind as PaymentKind,
        amount: toAmount(BigInt(p.amount_minor)),
        refunded: toAmount(BigInt(p.refunded_minor)),
        remaining: toAmount(BigInt(p.amount_minor) - BigInt(p.refunded_minor)),
        capturedAt: studioInstant(p.captured_at),
        killbillPaymentId: p.kb_payment_ids[0] ?? "",
      })),
    ...(withBusiness ? { businessName: row.business_name } : {}),
  };
}

export async function present(rowsIn: OrderRow[], db: Db | null = null, withBusiness = false): Promise<Order[]> {
  const payments = await paymentsOf(db, rowsIn.map((r) => r.id));
  return rowsIn.map((row) => orderBody(row, payments, withBusiness));
}

export async function presentOne(row: OrderRow, db: Db | null = null, withBusiness = false): Promise<Order> {
  return (await present([row], db, withBusiness))[0]!;
}

export async function orderById(id: string, db?: Db, lock = false): Promise<OrderRow | undefined> {
  const sql = lock ? "SELECT o.*, NULL::uuid AS project_id, NULL::text AS business_name FROM orders o WHERE o.id = $1 FOR UPDATE" : `${ORDER_SELECT} WHERE o.id = $1`;
  return db ? (await rows<OrderRow>(db, sql, [id]))[0] : (await query<OrderRow>(sql, [id]))[0];
}

/**
 * The one access rule for orders. A quoted order belongs to the session that created it; from
 * acceptance it belongs to its client account. Anyone who may not see it gets 404; a teammate of
 * the owning account gets 403.
 */
export function canSee(order: OrderRow, session: Session | null): "owner" | "studio" | "teammate" | null {
  const user = session?.user ?? null;
  if (order.state === "quoted") return session && order.creator_key === session.ownerKey ? "owner" : null;
  if (!user) return null;
  if (user.role === "studio_owner") return "studio";
  if (user.accountId && user.accountId === order.account_id) {
    if (user.role === "client_owner") return "owner";
    if (user.role === "teammate") return "teammate";
  }
  return null;
}

export async function visibleOrder(id: string, session: Session | null): Promise<OrderRow> {
  const order = await orderById(id);
  const access = order ? canSee(order, session) : null;
  if (!order || !access) throw errors.notFound();
  if (access === "teammate") throw errors.forbidden();
  return order;
}

/** Order states and the only moves between them. */
const MOVES: Record<OrderState, OrderState[]> = {
  quoted: ["accepted"],
  accepted: ["deposit_paid", "paid_in_full"],
  deposit_paid: ["in_build"],
  in_build: ["balance_invoiced"],
  balance_invoiced: ["paid_in_full"],
  paid_in_full: ["closed"],
  closed: [],
};

function assertMove(order: OrderRow, to: OrderState): void {
  const careStop = isCare(order.plan) && to === "closed";
  if (!MOVES[order.state].includes(to) || careStop) throw errors.invalidTransition(order.state);
}

// ---- quoting

export function readPick(body: unknown): { plan: PlanId; currency: Currency } {
  const input = record(body);
  const fields: Record<string, string> = {};
  if (!isPlanId(input.plan)) fields.plan = "Choose Launch Page, Studio Site, Care Lite or Care Plus.";
  if (!isCurrency(input.currency)) fields.currency = "Choose USD or ARS.";
  if (Object.keys(fields).length) throw errors.invalid(fields);
  return { plan: input.plan as PlanId, currency: input.currency as Currency };
}

export async function createOrder(session: Session, plan: PlanId, currency: Currency, now: Date): Promise<Order> {
  const price = await priceAt(plan, currency, now);
  const figures = figuresFor(plan, price.amountMinor);
  const id = randomUUID();
  const [row] = await query<OrderRow>(
    `WITH created AS (
       INSERT INTO orders (id, number, creator_key, plan, currency, state, total_minor, due_now_minor, due_at_launch_minor, price_id)
       VALUES ($1, 'PB-' || lpad(nextval('order_number_seq')::text, 4, '0'), $2, $3, $4, 'quoted', $5, $6, $7, $8)
       RETURNING *)
     SELECT created.*, NULL::uuid AS project_id, NULL::text AS business_name FROM created`,
    [id, session.ownerKey, plan, currency, figures.total.toString(), figures.dueNow.toString(), figures.dueAtLaunch.toString(), price.id],
  );
  return presentOne(row!);
}

// ---- acceptance

async function careFor(db: Db, accountId: string): Promise<{ kb_subscription_id: string }[]> {
  return rows<{ kb_subscription_id: string }>(db, "SELECT kb_subscription_id FROM care_plans WHERE account_id = $1", [accountId]);
}

async function liveCarePlan(db: Db, accountId: string, orderId: string): Promise<boolean> {
  const pending = await rows(db, "SELECT 1 FROM orders WHERE account_id = $1 AND id <> $2 AND plan LIKE 'care-%' AND state = 'accepted'", [accountId, orderId]);
  if (pending.length) return true;
  for (const plan of await careFor(db, accountId)) {
    const subscription = (await billing.kb("GET", `/subscriptions/${plan.kb_subscription_id}`)).json as { state?: string } | null;
    if (subscription?.state && !["CANCELLED", "EXPIRED"].includes(subscription.state)) return true;
  }
  return false;
}

export async function accept(id: string, session: Session | null, body: unknown, now: Date): Promise<{ order: Order; user: User; token?: string }> {
  const input = record(body);
  const outcome = await tx(async (db): Promise<{ stale: Order } | { order: Order; user: User; token?: string }> => {
    await db.query("SET LOCAL lock_timeout = '15s'");
    const order = await orderById(id, db, true);
    if (!order || !session || order.creator_key !== session.ownerKey || (order.state !== "quoted" && canSee(order, session) === null)) {
      throw errors.notFound();
    }
    if (session.user && session.user.role !== "client_owner") throw errors.forbidden();
    if (order.state !== "quoted") throw errors.invalidTransition(order.state);

    const price = await priceAt(order.plan, order.currency, now, db);
    if (price.amountMinor !== BigInt(order.total_minor)) {
      const figures = figuresFor(order.plan, price.amountMinor);
      await db.query("UPDATE orders SET total_minor = $2, due_now_minor = $3, due_at_launch_minor = $4, price_id = $5 WHERE id = $1", [
        id,
        figures.total.toString(),
        figures.dueNow.toString(),
        figures.dueAtLaunch.toString(),
        price.id,
      ]);
      return { stale: await presentOne((await orderById(id, db))!, db) };
    }

    const owner = session.user;
    if (owner?.accountId && isCare(order.plan) && (await liveCarePlan(db, owner.accountId, order.id))) {
      throw new HttpError(409, "plan_exists", "Your account already has a care plan.");
    }

    const fields: Record<string, string> = {};
    let accountId = owner?.accountId ?? null;
    if (owner && accountId) {
      const [account] = await rows<{ currency: Currency | null }>(db, "SELECT currency FROM client_accounts WHERE id = $1", [accountId]);
      if (account?.currency && account.currency !== order.currency) fields.currency = copyFor.accountBills(account.currency);
    } else {
      const businessName = typeof input.businessName === "string" ? input.businessName.trim() : "";
      const name = typeof input.name === "string" ? input.name.trim() : "";
      if (businessName.length < 1 || businessName.length > 120) fields.businessName = "Enter your business name (up to 120 characters).";
      if (name.length < 1 || name.length > 80) fields.name = "Enter your name (up to 80 characters).";
      if (!validEmail(input.email)) fields.email = "Enter a valid email address.";
      else if (await emailTaken(input.email.trim(), db)) fields.email = "That email already has a Pampero Ledger sign-in. Sign in instead.";
      if (typeof input.password !== "string" || input.password.length < 10) fields.password = "Use at least 10 characters.";
    }
    if (input.acceptTerms !== true) fields.acceptTerms = "Tick the box to accept the scope and price.";
    if (Object.keys(fields).length) throw errors.invalid(fields);

    let user = owner;
    let token: string | undefined;
    if (!user || !accountId) {
      accountId = randomUUID();
      const userId = randomUUID();
      await db.query("INSERT INTO client_accounts (id, business_name, currency) VALUES ($1, $2, $3)", [
        accountId,
        String(input.businessName).trim(),
        order.currency,
      ]);
      const [created] = await rows<Row & { id: string; name: string; email: string; role: "client_owner"; account_id: string }>(
        db,
        "INSERT INTO users (id, account_id, role, name, email, password_hash) VALUES ($1, $2, 'client_owner', $3, $4, $5) RETURNING *",
        [userId, accountId, String(input.name).trim(), String(input.email).trim(), await hashPassword(String(input.password))],
      );
      user = toUser(created!);
      token = await signIn(db, userId, session);
    } else {
      await db.query("UPDATE client_accounts SET currency = COALESCE(currency, $2) WHERE id = $1", [accountId, order.currency]);
    }
    await db.query("UPDATE orders SET state = 'accepted', account_id = $2, accepted_at = $3, price_id = $4 WHERE id = $1", [
      id,
      accountId,
      now,
      price.id,
    ]);
    const accepted = await presentOne((await orderById(id, db))!, db);
    return { order: accepted, user, ...(token ? { token } : {}) };
  });
  // The re-quote at the new price is committed before the refusal is sent.
  if ("stale" in outcome) throw new HttpError(409, "quote_stale", COPY.priceChanged, undefined, { order: outcome.stale });
  return outcome;
}

// ---- paying

interface AccountRow extends Row {
  id: string;
  business_name: string;
  currency: Currency;
  kb_account_id: string | null;
  card_last4: string | null;
  owner_email: string;
}

export async function accountWithOwner(db: Db | null, accountId: string): Promise<AccountRow> {
  const sql = `SELECT a.*, u.email AS owner_email FROM client_accounts a
               JOIN users u ON u.account_id = a.id AND u.role = 'client_owner' WHERE a.id = $1`;
  const [account] = db ? await rows<AccountRow>(db, sql, [accountId]) : await query<AccountRow>(sql, [accountId]);
  if (!account) throw errors.notFound();
  return account;
}

async function billingAccount(account: AccountRow): Promise<string> {
  return billing.ensureAccount({
    externalKey: `pampero-${account.id}`,
    name: account.business_name,
    email: account.owner_email,
    currency: account.currency,
  });
}

/** Waits until Kill Bill has invoiced a subscription's first period and set its charged-through date. */
export async function firstCareInvoice(kbAccountId: string, subscriptionId: string): Promise<billing.KbInvoice> {
  for (let tries = 0; tries < 60; tries++) {
    const sub = (await billing.kb("GET", `/subscriptions/${subscriptionId}`)).json as billing.KbSubscription;
    const invoices = await billing.accountInvoices(kbAccountId);
    const first = invoices.find((inv) => inv.status !== "VOID" && inv.items.some((i) => i.subscriptionId === subscriptionId && i.itemType === "RECURRING"));
    if (sub?.chargedThroughDate && first) return first;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw errors.billing();
}

interface PayResult {
  order: Order;
  payment: { kind: PaymentKind; amount: string; currency: Currency; killbillPaymentId: string };
  receiptUrl: string;
}

const RECEIPT_KIND: Record<PaymentKind, ReceiptKind> = { deposit: "Deposit", balance: "Launch balance", care: "Care plan" };

/**
 * Pay: hold the invoice in Kill Bill, authorize, create the portal folder, write the ledger in one
 * transaction, then capture. Any failure after the authorization voids it and the invoice made for
 * this Pay, removes the folder and rolls the ledger back, so the order stays as it was.
 */
export async function pay(orderId: string, session: Session, body: unknown, now: Date): Promise<PayResult> {
  const { result, settlement } = await tx(async (db) => {
    await db.query("SET LOCAL lock_timeout = '15s'");
    const order = await orderById(orderId, db, true);
    if (!order) throw errors.notFound();
    if (order.state !== "accepted" && order.state !== "balance_invoiced") throw errors.invalidTransition(order.state);
    const card = readCard(body, now);
    if (!approves(card.last4)) throw declined();

    const account = await accountWithOwner(db, order.account_id!);
    const kbAccountId = await billingAccount(account);
    const kind: PaymentKind = order.state === "balance_invoiced" ? "balance" : isCare(order.plan) ? "care" : "deposit";
    let held: billing.KbInvoice | null = null;
    let createdInvoice: string | null = null;
    let subscription: billing.KbSubscription | null = null;
    if (kind === "deposit") {
      held = await billing.externalCharge(kbAccountId, BigInt(order.due_now_minor), order.currency, `${order.number} deposit`);
      createdInvoice = held.invoiceId;
    } else if (kind === "balance") {
      held = await billing.invoice(order.balance_invoice_id!);
      if (!held) throw errors.billing();
    } else {
      const plan = order.plan as "care-lite" | "care-plus";
      const planName = `${plan}-monthly`;
      const bundle = await billing.createSubscription({
        accountId: kbAccountId,
        bundleKey: `care-${order.id}`,
        planName,
        overrides: billing.careOverride(planName, SEED_PRICES[plan][order.currency], BigInt(order.total_minor)),
      });
      subscription = bundle.subscriptions[0]!;
      held = await firstCareInvoice(kbAccountId, subscription.subscriptionId);
      createdInvoice = held.invoiceId;
    }
    const amount = billing.kbMinor(held.balance);
    const paymentIds = amount > 0n ? await billing.authorize(kbAccountId, amount, order.currency, `${order.id}-${kind}`) : [];

    const marker = objectKeys.portal(order.id);
    let markerWritten = false;
    let captured: Settlement | null = null;
    try {
      if (kind !== "balance") {
        await putObject(marker, Buffer.from(`${order.number}\n`));
        markerWritten = true;
      }
      const paymentId = randomUUID();
      await db.query(
        "INSERT INTO payments (id, order_id, kind, amount_minor, kb_payment_ids, kb_invoice_id, settled, captured_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        [paymentId, order.id, kind, amount.toString(), paymentIds, held.invoiceId, amount === 0n, now],
      );
      const nextState: OrderState = kind === "deposit" ? "deposit_paid" : "paid_in_full";
      assertMove(order, nextState);
      await db.query("UPDATE orders SET state = $2 WHERE id = $1", [order.id, nextState]);
      await db.query("UPDATE client_accounts SET kb_account_id = $2, card_last4 = $3 WHERE id = $1", [account.id, kbAccountId, card.last4]);
      if (kind === "deposit") {
        await db.query("INSERT INTO projects (id, order_id, account_id) VALUES ($1, $2, $3)", [randomUUID(), order.id, account.id]);
      }
      if (kind === "care" && subscription) {
        await db.query(
          "INSERT INTO care_plans (id, order_id, account_id, tier, monthly_minor, kb_bundle_id, kb_subscription_id) VALUES ($1, $2, $3, $4, $5, $6, $7)",
          [randomUUID(), order.id, account.id, careTier(order.plan as "care-lite" | "care-plus"), order.total_minor, subscription.bundleId, subscription.subscriptionId],
        );
      }
      await db.query("INSERT INTO invoice_pdfs (kb_invoice_id, order_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [held.invoiceId, order.id]);
      await enqueue(
        db,
        messages.receipt({ key: paymentId, to: account.owner_email, orderId: order.id, orderNumber: order.number, kind: RECEIPT_KIND[kind], amount, currency: order.currency }),
      );
      // The ledger write above becomes visible only when this transaction commits, after the capture
      // succeeds; a failed capture rolls it back, so a failed Pay leaves nothing in the ledger.
      await billing.capture(paymentIds, order.currency);
      captured = { kbAccountId, invoiceId: held.invoiceId, amount, paymentId };
    } catch (error) {
      await billing.voidPayments(paymentIds).catch(() => undefined);
      if (subscription) await billing.cancelNow(subscription.subscriptionId).catch(() => undefined);
      if (createdInvoice) await billing.voidInvoice(createdInvoice).catch(() => undefined);
      if (markerWritten) await deleteObject(marker).catch(() => undefined);
      if (error instanceof HttpError && error.code === "storage_unavailable") throw errors.storage(COPY.storagePayOutage);
      if (error instanceof HttpError) throw error;
      throw errors.billing();
    }
    const paid = await presentOne((await orderById(order.id, db))!, db);
    return {
      result: {
        order: paid,
        payment: { kind, amount: toAmount(amount), currency: order.currency, killbillPaymentId: paymentIds[0] ?? "" },
        receiptUrl: `/orders/${order.id}/receipt`,
      },
      settlement: captured,
    };
  });
  if (settlement) await settle(settlement);
  return result;
}

export interface Settlement {
  kbAccountId: string;
  invoiceId: string;
  amount: bigint;
  paymentId: string;
}

/** Settles the captured invoice in Kill Bill; a failure is retried by the maintenance sweep. */
export async function settle(s: Settlement): Promise<void> {
  if (s.amount <= 0n) return;
  try {
    await billing.settleInvoice(s.kbAccountId, s.invoiceId, s.amount, `${s.paymentId}-settlement`);
    await query("UPDATE payments SET settled = true WHERE id = $1", [s.paymentId]);
  } catch {
    // The sweep in workers.ts retries unsettled payments.
  }
}

// ---- studio transitions

export async function transition(orderId: string, body: unknown): Promise<Order> {
  const to = record(body).to;
  return tx(async (db) => {
    await db.query("SET LOCAL lock_timeout = '15s'");
    const order = await orderById(orderId, db, true);
    if (!order || order.state === "quoted") throw errors.notFound();
    if (to !== "in_build" && to !== "balance_invoiced" && to !== "closed") throw errors.invalidTransition(order.state);
    assertMove(order, to);
    if (to === "balance_invoiced") {
      const account = await accountWithOwner(db, order.account_id!);
      const kbAccountId = await billingAccount(account);
      const invoice = await billing.externalCharge(kbAccountId, BigInt(order.due_at_launch_minor), order.currency, `${order.number} launch balance`);
      await db.query("UPDATE orders SET balance_invoice_id = $2 WHERE id = $1", [order.id, invoice.invoiceId]);
      await db.query("INSERT INTO invoice_pdfs (kb_invoice_id, order_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [invoice.invoiceId, order.id]);
      await enqueue(
        db,
        messages.invoiceNotice({
          invoiceId: invoice.invoiceId,
          to: account.owner_email,
          invoiceNumber: invoice.invoiceNumber,
          amount: billing.kbMinor(invoice.amount),
          due: billing.kbMinor(invoice.balance),
          currency: order.currency,
        }),
      );
    }
    if (to === "closed") await db.query("UPDATE projects SET closed_at = now() WHERE order_id = $1", [order.id]);
    await db.query("UPDATE orders SET state = $2 WHERE id = $1", [order.id, to]);
    return presentOne((await orderById(order.id, db))!, db, true);
  });
}

// ---- refunds and credits

function positiveAmount(value: unknown): bigint | null {
  const amount = typeof value === "string" ? parseAmount(value) : null;
  return amount !== null && amount > 0n ? amount : null;
}

export async function issueRefund(orderId: string, body: unknown) {
  const input = record(body);
  return tx(async (db) => {
    await db.query("SET LOCAL lock_timeout = '15s'");
    const order = await orderById(orderId, db);
    if (!order || order.state === "quoted") throw errors.notFound();
    const kind = input.payment;
    const [payment] = await rows<PaymentRow>(
      db,
      "SELECT *, 0 AS refunded_minor FROM payments WHERE order_id = $1 AND kind = $2 ORDER BY captured_at LIMIT 1 FOR UPDATE",
      [order.id, kind === "deposit" || kind === "balance" ? kind : "none"],
    );
    if (!payment) {
      if (kind !== "deposit" && kind !== "balance") throw errors.invalid({ payment: "Choose Deposit or Launch balance." });
      throw new HttpError(409, "payment_not_captured", "That payment hasn't been captured yet.");
    }
    const [{ refunded }] = (await rows<{ refunded: string }>(db, "SELECT COALESCE(sum(amount_minor), 0) AS refunded FROM refunds WHERE payment_id = $1", [payment.id])) as [{ refunded: string }];
    const remaining = BigInt(payment.amount_minor) - BigInt(refunded);
    const amount = positiveAmount(input.amount);
    const fields: Record<string, string> = {};
    if (amount === null) fields.amount = "Enter a positive amount with at most two decimals.";
    else if (amount > remaining) fields.amount = copyFor.overCap(formatMoney(remaining, order.currency));
    const reason = typeof input.reason === "string" ? input.reason.trim() : "";
    if (!reason || reason.length > 200) fields.reason = "Give a reason (up to 200 characters).";
    if (Object.keys(fields).length) throw errors.invalid(fields);

    const transactions: string[] = [];
    let left = amount!;
    for (const kbPaymentId of payment.kb_payment_ids) {
      if (left === 0n) break;
      const kbPayment = (await billing.kb("GET", `/payments/${kbPaymentId}`)).json as { capturedAmount: string; refundedAmount: string };
      const room = billing.kbMinor(kbPayment.capturedAmount) - billing.kbMinor(kbPayment.refundedAmount);
      const part = room < left ? room : left;
      if (part <= 0n) continue;
      transactions.push(await billing.refund(kbPaymentId, part, order.currency));
      left -= part;
    }
    const refundId = randomUUID();
    await db.query("INSERT INTO refunds (id, payment_id, amount_minor, reason, kb_transaction_ids) VALUES ($1, $2, $3, $4, $5)", [
      refundId,
      payment.id,
      amount!.toString(),
      reason,
      transactions,
    ]);
    const account = await accountWithOwner(db, order.account_id!);
    const after = remaining - amount!;
    await enqueue(db, messages.refund({ refundId, to: account.owner_email, orderNumber: order.number, amount: amount!, left: after, currency: order.currency }));
    return {
      refund: { id: refundId, payment: payment.kind, amount: toAmount(amount!), currency: order.currency, killbillTransactionId: transactions[0] ?? "" },
      payment: {
        kind: payment.kind,
        amount: toAmount(BigInt(payment.amount_minor)),
        refunded: toAmount(BigInt(refunded) + amount!),
        remaining: toAmount(after),
      },
    };
  });
}

export async function addAccountCredit(accountId: string, body: unknown) {
  const input = record(body);
  return tx(async (db) => {
    const [account] = await rows<AccountRow>(
      db,
      `SELECT a.*, u.email AS owner_email FROM client_accounts a
       JOIN users u ON u.account_id = a.id AND u.role = 'client_owner' WHERE a.id = $1 FOR UPDATE OF a`,
      [accountId],
    );
    if (!account) throw errors.notFound();
    if (!account.kb_account_id) throw new HttpError(409, "no_billing_account", "This account has no billing account yet.");
    const fields: Record<string, string> = {};
    const amount = positiveAmount(input.amount);
    if (amount === null) fields.amount = "Enter a positive amount with at most two decimals.";
    if (input.currency !== account.currency) fields.currency = copyFor.creditCurrency(account.currency);
    const reason = typeof input.reason === "string" ? input.reason.trim() : "";
    if (!reason || reason.length > 200) fields.reason = "Give a reason (up to 200 characters).";
    if (Object.keys(fields).length) throw errors.invalid(fields);
    const creditId = randomUUID();
    await billing.addCredit(account.kb_account_id, amount!, account.currency, reason);
    const held = await billing.accountCredit(account.kb_account_id);
    await db.query("INSERT INTO credits (id, account_id, amount_minor, currency, reason) VALUES ($1, $2, $3, $4, $5)", [
      creditId,
      account.id,
      amount!.toString(),
      account.currency,
      reason,
    ]);
    await enqueue(db, messages.credit({ creditId, to: account.owner_email, amount: amount!, currency: account.currency, reason }));
    return { credit: { id: creditId, amount: toAmount(amount!), currency: account.currency }, accountCredit: toAmount(held) };
  });
}
