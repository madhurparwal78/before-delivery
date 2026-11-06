import { randomUUID } from "node:crypto";
import { type PoolClient } from "pg";
import { query, withTransaction } from "../db.js";
import { ApiError, errors } from "../errors.js";
import * as killbill from "../services/killbill.js";
import * as storage from "../services/storage.js";
import { invoiceNoticeMessage, queueMessage, receiptMessage, refundMessage } from "../mailer.js";
import { refundOverCap } from "../../shared/copy.js";
import { type Currency, type Money, formatMoney, money, toAmountString } from "../../shared/money.js";
import { careTierOf, isCarePlan } from "../../shared/plans.js";
import {
  type ClientAccountRow,
  accountById,
  ownerOfAccount,
  setKillbillAccount,
} from "./accounts.js";
import {
  type OrderRow,
  type PaymentKind,
  assertMove,
  orderByIdForUpdate,
} from "./orders.js";
import { type CheckedCard } from "./cards.js";

export type InvoiceKind = "deposit" | "balance" | "care" | "renewal" | "change";

export async function ensureBillingAccount(account: ClientAccountRow, ownerEmail: string): Promise<string> {
  if (account.killbillAccountId) return account.killbillAccountId;
  const currency = account.currency;
  if (!currency) throw errors.noBillingAccount();
  const killbillAccountId = await killbill.createAccount({
    externalKey: `pampero-${account.id}`,
    name: account.businessName,
    email: ownerEmail,
    currency,
  });
  await setKillbillAccount(account.id, killbillAccountId);
  return killbillAccountId;
}

export async function registerInvoice(input: {
  invoice: killbill.KbInvoice;
  accountId: string;
  orderId: string | null;
  kind: InvoiceKind;
  client?: PoolClient | null;
}): Promise<void> {
  const sql = `insert into invoice_tasks (killbill_invoice_id, account_id, order_id, kind, invoice_number)
               values ($1, $2, $3, $4, $5) on conflict (killbill_invoice_id) do nothing`;
  const values = [
    input.invoice.invoiceId,
    input.accountId,
    input.orderId,
    input.kind,
    input.invoice.invoiceNumber,
  ];
  if (input.client) await input.client.query(sql, values);
  else await query(sql, values);
}

interface PayPlan {
  kind: PaymentKind;
  paymentExternalKey: string;
}

function payPlanFor(order: OrderRow): PayPlan {
  if (order.state === "accepted") {
    if (isCarePlan(order.plan)) return { kind: "care", paymentExternalKey: `${order.id}-care` };
    return { kind: "deposit", paymentExternalKey: `${order.id}-deposit` };
  }
  if (order.state === "balance_invoiced") {
    return { kind: "balance", paymentExternalKey: `${order.id}-balance` };
  }
  throw errors.invalidTransition(order.state);
}

export interface PaidOrder {
  orderId: string;
  kind: PaymentKind;
  amount: Money;
  killbillPaymentId: string;
}

/**
 * Holds the invoice, authorizes, opens the portal folder, writes the ledger once and only then
 * captures. Anything that fails after the authorization voids it and leaves nothing behind.
 */
export async function payOrder(input: {
  order: OrderRow;
  account: ClientAccountRow;
  ownerEmail: string;
  card: CheckedCard;
}): Promise<PaidOrder> {
  const killbillAccountId = await ensureBillingAccount(input.account, input.ownerEmail);
  const plan = payPlanFor(input.order);
  const paymentExternalKey = await killbill.freePaymentExternalKey(plan.paymentExternalKey);

  let authorizedPaymentId: string | null = null;
  let invoiceToVoid: string | null = null;
  let subscriptionToCancel: string | null = null;
  let folderMarkerKey: string | null = null;
  let captured = false;

  try {
    return await withTransaction(async (client) => {
      await client.query("set local lock_timeout = '15s'");
      const order = await orderByIdForUpdate(client, input.order.id);
      if (!order) throw errors.notFound();
      const confirmed = payPlanFor(order);
      const nextState = confirmed.kind === "balance" ? "paid_in_full" : isCarePlan(order.plan) ? "paid_in_full" : "deposit_paid";
      assertMove(order, nextState);

      let invoice: killbill.KbInvoice;
      let invoiceKind: InvoiceKind;
      if (confirmed.kind === "deposit") {
        const invoiceId = await killbill.createExternalCharge(
          killbillAccountId,
          order.dueNow,
          `${order.number} deposit`,
        );
        invoiceToVoid = invoiceId;
        invoice = await killbill.getInvoice(invoiceId);
        invoiceKind = "deposit";
        await client.query(`update orders set deposit_invoice_id = $2 where id = $1`, [order.id, invoiceId]);
      } else if (confirmed.kind === "balance") {
        if (!order.balanceInvoiceId) throw errors.invalidTransition(order.state);
        invoice = await killbill.getInvoice(order.balanceInvoiceId);
        invoiceKind = "balance";
      } else {
        const subscription = await killbill.createSubscription({
          accountId: killbillAccountId,
          bundleExternalKey: `care-${order.id}`,
          tier: careTierOf(order.plan),
          price: order.total,
        });
        subscriptionToCancel = subscription.subscriptionId;
        await client.query(
          `update orders set care_subscription_id = $2, care_bundle_id = $3, care_tier = $4 where id = $1`,
          [order.id, subscription.subscriptionId, subscription.bundleId, careTierOf(order.plan)],
        );
        const invoices = await killbill.listInvoices(killbillAccountId);
        const open = invoices
          .filter((candidate) =>
            candidate.items.some((item) => item.subscriptionId === subscription.subscriptionId),
          )
          .sort((left, right) => left.invoiceDate.localeCompare(right.invoiceDate))[0];
        if (!open) throw errors.billingUnavailable();
        invoice = open;
        invoiceToVoid = open.invoiceId;
        invoiceKind = "care";
      }

      const amount: Money =
        confirmed.kind === "balance"
          ? money(order.currency, invoice.balance.minor)
          : confirmed.kind === "deposit"
            ? order.dueNow
            : money(order.currency, invoice.balance.minor);

      authorizedPaymentId = await killbill.authorize(killbillAccountId, amount, paymentExternalKey);

      const marker = storage.portalFolderMarkerKey(order.id);
      await storage.putObject(marker, Buffer.from("pampero portal folder\n"));
      folderMarkerKey = marker;

      const paymentId = randomUUID();
      await client.query(
        `insert into payments (id, order_id, kind, amount_minor, currency, killbill_payment_id, killbill_invoice_id)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [
          paymentId,
          order.id,
          confirmed.kind,
          amount.minor.toString(),
          amount.currency,
          authorizedPaymentId,
          invoice.invoiceId,
        ],
      );
      await client.query(`update orders set state = $2 where id = $1`, [order.id, nextState]);
      if (confirmed.kind === "deposit") {
        await client.query(`insert into projects (id, order_id, account_id) values ($1, $2, $3)`, [
          randomUUID(),
          order.id,
          order.accountId,
        ]);
      }
      await registerInvoice({
        invoice,
        accountId: order.accountId ?? input.account.id,
        orderId: order.id,
        kind: invoiceKind,
        client,
      });
      await queueMessage(
        client,
        receiptMessage({
          to: input.ownerEmail,
          orderId: order.id,
          orderNumber: order.number,
          kind: confirmed.kind,
          amount,
          paymentId,
        }),
      );

      await killbill.capture(authorizedPaymentId, amount, paymentExternalKey);
      captured = true;
      await killbill.settleInvoice(killbillAccountId, invoice.invoiceId, amount, `${paymentExternalKey}-settle`);

      return {
        orderId: order.id,
        kind: confirmed.kind,
        amount,
        killbillPaymentId: authorizedPaymentId,
      };
    });
  } catch (error) {
    if (!captured && authorizedPaymentId) {
      await killbill.voidPayment(authorizedPaymentId, paymentExternalKey).catch(() => undefined);
      if (invoiceToVoid) await killbill.voidInvoice(invoiceToVoid).catch(() => undefined);
      if (subscriptionToCancel) {
        await killbill.cancelSubscription(subscriptionToCancel, true).catch(() => undefined);
      }
      if (folderMarkerKey) await storage.deleteObject(folderMarkerKey).catch(() => undefined);
    }
    throw error;
  }
}

export async function invoiceLaunchBalance(order: OrderRow): Promise<void> {
  const account = await accountById(order.accountId ?? "");
  const owner = order.accountId ? await ownerOfAccount(order.accountId) : null;
  if (!account || !owner) throw errors.notFound();
  const killbillAccountId = await ensureBillingAccount(account, owner.email);
  const invoiceId = await killbill.createExternalCharge(
    killbillAccountId,
    order.dueAtLaunch,
    `${order.number} launch balance`,
  );
  const invoice = await killbill.getInvoice(invoiceId);
  await query(`update orders set balance_invoice_id = $2, state = 'balance_invoiced' where id = $1`, [
    order.id,
    invoiceId,
  ]);
  await registerInvoice({ invoice, accountId: account.id, orderId: order.id, kind: "balance" });
  await query(`update invoice_tasks set notice_sent_at = now() where killbill_invoice_id = $1`, [invoiceId]);
  await queueMessage(
    null,
    invoiceNoticeMessage({
      to: owner.email,
      invoiceId,
      invoiceNumber: invoice.invoiceNumber,
      amount: invoice.amount,
      due: invoice.balance,
    }),
  );
}

export interface RefundResult {
  refundId: string;
  killbillTransactionId: string;
  amount: Money;
  paymentKind: PaymentKind;
  paymentAmount: Money;
  refunded: Money;
  remaining: Money;
}

export async function refundPayment(input: {
  order: OrderRow;
  paymentKind: "deposit" | "balance";
  amount: Money;
  reason: string;
}): Promise<RefundResult> {
  const owner = input.order.accountId ? await ownerOfAccount(input.order.accountId) : null;
  const result = await withTransaction(async (client) => {
    await client.query("set local lock_timeout = '15s'");
    const payment = await client.query<{
      id: string;
      amount_minor: string;
      currency: string;
      killbill_payment_id: string;
    }>(
      `select p.id, p.amount_minor, p.currency, p.killbill_payment_id
         from payments p
        where p.order_id = $1 and p.kind = $2
        for update`,
      [input.order.id, input.paymentKind],
    );
    const row = payment.rows[0];
    if (!row) throw errors.paymentNotCaptured();
    // A second statement sees every refund committed while this one waited for the row lock.
    const sum = await client.query<{ refunded_minor: string }>(
      `select coalesce(sum(amount_minor), 0)::text as refunded_minor from refunds where payment_id = $1`,
      [row.id],
    );
    const currency = row.currency as Currency;
    const captured = money(currency, BigInt(row.amount_minor));
    const refundedSoFar = money(currency, BigInt(sum.rows[0]?.refunded_minor ?? "0"));
    const remaining = money(currency, captured.minor - refundedSoFar.minor);
    if (input.amount.minor > remaining.minor) {
      throw new ApiError(422, "validation_failed", "Some details need fixing.", {
        amount: refundOverCap(formatMoney(remaining)),
      });
    }
    const refundId = randomUUID();
    const killbillTransactionId = await killbill.refundPayment(
      row.killbill_payment_id,
      input.amount,
      `${refundId}-refund`,
    );
    await client.query(
      `insert into refunds (id, payment_id, amount_minor, reason, killbill_transaction_id)
       values ($1, $2, $3, $4, $5)`,
      [refundId, row.id, input.amount.minor.toString(), input.reason, killbillTransactionId],
    );
    const nowRefunded = money(currency, refundedSoFar.minor + input.amount.minor);
    const nowRemaining = money(currency, captured.minor - nowRefunded.minor);
    if (owner) {
      await queueMessage(
        client,
        refundMessage({
          to: owner.email,
          refundId,
          orderNumber: input.order.number,
          amount: input.amount,
          remaining: nowRemaining,
        }),
      );
    }
    return {
      refundId,
      killbillTransactionId,
      amount: input.amount,
      paymentKind: input.paymentKind as PaymentKind,
      paymentAmount: captured,
      refunded: nowRefunded,
      remaining: nowRemaining,
    };
  });
  return result;
}

export interface InvoiceView {
  id: string;
  number: string;
  date: string;
  kind: InvoiceKind;
  description: string;
  amount: Money;
  balance: Money;
  currency: Currency;
  status: "paid" | "open" | "void" | "credit";
  orderId: string | null;
  pdf: boolean;
}

function invoiceStatus(invoice: killbill.KbInvoice): "paid" | "open" | "void" | "credit" {
  if (invoice.status === "VOID") return "void";
  if (invoice.amount.minor < 0n) return "credit";
  if (invoice.balance.minor > 0n) return "open";
  return "paid";
}

interface CareOrderLink {
  orderId: string;
  number: string;
  subscriptionId: string | null;
  bundleId: string | null;
  depositInvoiceId: string | null;
  balanceInvoiceId: string | null;
  firstCareInvoiceId: string | null;
}

async function orderLinks(accountId: string): Promise<CareOrderLink[]> {
  const rows = await query<{
    id: string;
    number: string;
    care_subscription_id: string | null;
    care_bundle_id: string | null;
    deposit_invoice_id: string | null;
    balance_invoice_id: string | null;
    care_invoice_id: string | null;
  }>(
    `select o.id, o.number, o.care_subscription_id, o.care_bundle_id, o.deposit_invoice_id, o.balance_invoice_id,
            (select killbill_invoice_id from payments where order_id = o.id and kind = 'care' limit 1) as care_invoice_id
       from orders o where o.account_id = $1`,
    [accountId],
  );
  return rows.map((row) => ({
    orderId: row.id,
    number: row.number,
    subscriptionId: row.care_subscription_id,
    bundleId: row.care_bundle_id,
    depositInvoiceId: row.deposit_invoice_id,
    balanceInvoiceId: row.balance_invoice_id,
    firstCareInvoiceId: row.care_invoice_id,
  }));
}

export interface ClassifiedInvoice {
  invoice: killbill.KbInvoice;
  kind: InvoiceKind;
  orderId: string | null;
  orderNumber: string | null;
}

const CHARGE_ITEMS = ["RECURRING", "EXTERNAL_CHARGE", "FIXED", "REPAIR_ADJ"];

function carriesCharges(invoice: killbill.KbInvoice): boolean {
  return invoice.items.some((item) => CHARGE_ITEMS.includes(item.itemType));
}

/** The one place a Kill Bill invoice is matched to an order and a kind. */
export async function classifyInvoices(accountId: string, invoices: killbill.KbInvoice[]): Promise<ClassifiedInvoice[]> {
  const links = await orderLinks(accountId);
  return invoices.filter(carriesCharges).map((invoice) => {
    const byDeposit = links.find((link) => link.depositInvoiceId === invoice.invoiceId);
    if (byDeposit) {
      return { invoice, kind: "deposit" as InvoiceKind, orderId: byDeposit.orderId, orderNumber: byDeposit.number };
    }
    const byBalance = links.find((link) => link.balanceInvoiceId === invoice.invoiceId);
    if (byBalance) {
      return { invoice, kind: "balance" as InvoiceKind, orderId: byBalance.orderId, orderNumber: byBalance.number };
    }
    const subscriptionId = invoice.items.find((item) => item.subscriptionId)?.subscriptionId ?? null;
    const bundleId = invoice.items.find((item) => item.bundleId)?.bundleId ?? null;
    const careLink =
      links.find((link) => link.subscriptionId && link.subscriptionId === subscriptionId) ??
      links.find((link) => link.bundleId && link.bundleId === bundleId) ??
      null;
    if (!careLink) return { invoice, kind: "renewal" as InvoiceKind, orderId: null, orderNumber: null };
    const hasRepair = invoice.items.some((item) => item.itemType === "REPAIR_ADJ");
    const kind: InvoiceKind = hasRepair
      ? "change"
      : careLink.firstCareInvoiceId === invoice.invoiceId
        ? "care"
        : "renewal";
    return { invoice, kind, orderId: careLink.orderId, orderNumber: careLink.number };
  });
}

function describeInvoice(classified: ClassifiedInvoice): string {
  const number = classified.orderNumber ?? "";
  switch (classified.kind) {
    case "deposit":
      return `${number} deposit`;
    case "balance":
      return `${number} launch balance`;
    case "care":
      return `${number} care plan first month`;
    case "change":
      return `${number} plan change`;
    default:
      return `${number} care plan renewal`;
  }
}

export async function invoiceViews(accountId: string): Promise<InvoiceView[]> {
  const account = await accountById(accountId);
  if (!account?.killbillAccountId) return [];
  const invoices = await killbill.listInvoices(account.killbillAccountId);
  const classified = await classifyInvoices(accountId, invoices);
  const storedPdfs = await query<{ killbill_invoice_id: string }>(
    `select killbill_invoice_id from invoice_tasks where account_id = $1 and pdf_stored_at is not null`,
    [accountId],
  );
  const stored = new Set(storedPdfs.map((row) => row.killbill_invoice_id));
  return classified
    .map((item) => ({
      id: item.invoice.invoiceId,
      number: item.invoice.invoiceNumber,
      date: item.invoice.invoiceDate,
      kind: item.kind,
      description: describeInvoice(item),
      amount: item.invoice.amount,
      balance: item.invoice.balance,
      currency: item.invoice.currency,
      status: invoiceStatus(item.invoice),
      orderId: item.orderId,
      pdf: stored.has(item.invoice.invoiceId),
    }))
    .sort((left, right) => Number(right.number) - Number(left.number));
}

export function serializeInvoice(view: InvoiceView): Record<string, unknown> {
  return {
    id: view.id,
    number: view.number,
    date: view.date,
    kind: view.kind,
    description: view.description,
    amount: toAmountString(view.amount),
    balance: toAmountString(view.balance),
    currency: view.currency,
    status: view.status,
    orderId: view.orderId,
    pdf: view.pdf,
  };
}

/** Pays an open invoice with the account's stored card and records the receipt. */
export async function chargeOpenInvoice(input: {
  order: OrderRow;
  killbillAccountId: string;
  ownerEmail: string;
  invoice: killbill.KbInvoice;
  kind: PaymentKind;
  paymentExternalKey: string;
}): Promise<void> {
  const amount = input.invoice.balance;
  const paymentExternalKey = await killbill.freePaymentExternalKey(input.paymentExternalKey);
  const paymentId = await killbill.authorize(input.killbillAccountId, amount, paymentExternalKey);
  await killbill.capture(paymentId, amount, paymentExternalKey);
  await killbill.settleInvoice(input.killbillAccountId, input.invoice.invoiceId, amount, `${paymentExternalKey}-settle`);
  const ledgerPaymentId = randomUUID();
  await query(
    `insert into payments (id, order_id, kind, amount_minor, currency, killbill_payment_id, killbill_invoice_id)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      ledgerPaymentId,
      input.order.id,
      input.kind,
      amount.minor.toString(),
      amount.currency,
      paymentId,
      input.invoice.invoiceId,
    ],
  );
  await queueMessage(
    null,
    receiptMessage({
      to: input.ownerEmail,
      orderId: input.order.id,
      orderNumber: input.order.number,
      kind: input.kind,
      amount,
      paymentId: ledgerPaymentId,
    }),
  );
}

