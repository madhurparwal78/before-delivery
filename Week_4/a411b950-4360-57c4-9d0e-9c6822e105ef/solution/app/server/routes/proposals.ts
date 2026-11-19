import { randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { config } from "../config.js";
import { one, query, transaction } from "../db.js";
import { fail, HttpError, notFound, sendJson } from "../http.js";
import { fingerprint, idempotencyKey, idempotent } from "../idempotency.js";
import {
  accountInvoices, billingUnavailable, createChargeInvoice, ensureAccount, findPurchase, getInvoice, type Invoice,
  invoicePaymentId, payInvoice, voidInvoice,
} from "../killbill.js";
import { depositLetter, heldLetter, proposalLetter, type ProposalTerms } from "../letters.js";
import { deliverForEnquiry, queueMail } from "../mail.js";
import { FEE_MAX_CENTS, FEE_MIN_CENTS, milestoneDescription, milestoneView, splitFee } from "../milestones.js";
import type { Context, Route } from "../router.js";
import { asObject, Checker, MONTH_KEY } from "../validate.js";
import { businessDate, monthLabel } from "../../shared/dates.js";
import { PROPOSAL_WRITABLE } from "../../shared/lifecycle.js";
import { formatUsd } from "../../shared/money.js";
import {
  assertMove, consoleWrite, type EnquiryRow, enquiryRow, reference,
} from "./enquiries.js";
import { lockMonth, monthIsOpen, monthState } from "./months.js";
import { settings } from "./session.js";

function terms(row: EnquiryRow): ProposalTerms {
  return {
    enquiryId: row.id,
    reference: reference(row),
    token: row.token ?? "",
    producer: { name: row.producer_name ?? "", address: row.producer_email ?? "" },
    projectTitle: row.project_title ?? "",
    scope: row.scope ?? "",
    feeCents: row.fee_cents ?? 0,
    productionMonth: row.production_month ?? "",
    milestoneCents: row.milestone_cents ?? [],
    expiresAt: row.expires_at ?? new Date(0),
  };
}

/** An invoice's date: the start date Kill Bill holds on its item with the milestone's description. */
function itemDate(invoice: Invoice, description: string): string {
  return invoice.items.find((item) => item.description === description)?.startDate ?? "";
}

// ---- Console: preview, send, invoice later milestones ----

async function preview({ res, json }: Context): Promise<void> {
  const check = new Checker(asObject(json)).writable(["fee_cents"]);
  const fee = check.integer("fee_cents", FEE_MIN_CENTS, FEE_MAX_CENTS);
  check.done();
  sendJson(res, 200, { milestones: milestoneView(splitFee(fee)) });
}

async function sendProposal(context: Context): Promise<void> {
  const check = new Checker(asObject(context.json)).writable(PROPOSAL_WRITABLE);
  await consoleWrite(context, 201, async (client, row) => {
    assertMove(row.read_status, "proposal_sent");
    const producerName = check.singleLine("producer_name", 1, 120);
    const producerEmail = check.address("producer_email");
    const projectTitle = check.singleLine("project_title", 1, 120);
    const scope = check.multiLine("scope", 1, 2000);
    const fee = check.integer("fee_cents", FEE_MIN_CENTS, FEE_MAX_CENTS);
    if (!check.errors.fee_cents && row.rate_floor_cents !== null && fee < row.rate_floor_cents) {
      check.error("fee_cents", `Below your rate floor of $${formatUsd(row.rate_floor_cents)}.`);
    }
    const month = check.body.production_month;
    if (typeof month !== "string" || !MONTH_KEY.test(month) || !(await monthIsOpen(client, month))) {
      check.error("production_month", "Choose an open production month from the current month on.");
    }
    check.done();
    const token = randomBytes(24).toString("base64url");
    const sentAt = Date.now();
    const expiresAt = new Date(sentAt + config.proposalTtlSeconds * 1000);
    const cents = splitFee(fee);
    await client.query(
      `INSERT INTO proposals (enquiry_id, token, producer_name, producer_email, project_title, scope, fee_cents,
         production_month, milestone_cents, sent_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [row.id, token, producerName, producerEmail, projectTitle, scope, fee, month, cents, new Date(sentAt), expiresAt],
    );
    await client.query("UPDATE enquiries SET status = 'proposal_sent' WHERE id = $1", [row.id]);
    const sent = await enquiryRow(row.id, client);
    await queueMail(client, proposalLetter(terms(sent), (await settings()).time_zone));
  });
}

async function invoiceMilestone(context: Context): Promise<void> {
  const number = Number.parseInt(context.params.n ?? "", 10);
  if (![2, 3, 4].includes(number) || String(number) !== context.params.n) notFound();
  new Checker(asObject(context.json)).writable([]).done();
  await consoleWrite(context, 201, async (client, row) => {
    const status = row.read_status;
    if (status !== "booked") fail(409, "illegal_transition", "Milestones are invoiced once production has started.", { from: status, to: "booked" });
    const next = 2 + row.invoiced_milestones.length;
    if (number < next) fail(409, "milestone_already_invoiced", `Milestone ${number} is already invoiced.`);
    if (number > next) fail(409, "milestone_out_of_order", `Invoice milestone ${next} first.`);
    const amount = row.milestone_cents?.[number - 1] ?? 0;
    const description = milestoneDescription(number, reference(row));
    const account = row.killbill_account_id ?? billingUnavailable();
    const held = (await accountInvoices(account)).find((invoice) =>
      invoice.status !== "VOID" && invoice.items.some((item) => item.description === description));
    if (held && !held.items.some((item) => item.description === description && item.amountCents === amount)) {
      fail(409, "milestone_mismatch", `Kill Bill already holds a different amount for milestone ${number}.`);
    }
    const invoice = held
      ?? (await createChargeInvoice(account, amount, description, businessDate(new Date(), (await settings()).time_zone)));
    const invoiceDate = itemDate(invoice, description);
    await client.query(
      `INSERT INTO milestone_invoices (enquiry_id, number, amount_cents, killbill_invoice_id, invoice_number, invoice_date)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [row.id, number, amount, invoice.invoiceId, invoice.invoiceNumber, invoiceDate],
    );
    return {
      milestone: {
        number, amount_cents: amount, invoice_number: invoice.invoiceNumber, killbill_invoice_id: invoice.invoiceId,
        invoice_date: invoiceDate,
      },
    };
  });
}

// ---- Producer: read, accept, pay ----

async function proposalId(token: string): Promise<string> {
  const row = await one<{ enquiry_id: string }>("SELECT enquiry_id FROM proposals WHERE token = $1", [token]);
  if (!row) notFound();
  return row.enquiry_id;
}

/** 410 for a declined enquiry or an expired proposal; the producer page is closed for both. */
function assertOpenToProducer(row: EnquiryRow): void {
  const status = row.read_status;
  if (status === "declined") fail(410, "proposal_closed", "This proposal is no longer open.");
  if (status === "expired") fail(410, "proposal_expired", "This proposal has expired.");
}

function depositView(row: EnquiryRow, billing: "live" | "unreachable") {
  if (!row.deposit_invoice_id) return null;
  return {
    invoice_number: row.deposit_invoice_number,
    killbill_invoice_id: row.deposit_invoice_id,
    amount_cents: row.deposit_amount_cents,
    balance_cents: row.deposit_balance_cents,
    paid: row.deposit_balance_cents === 0,
    invoice_date: row.deposit_invoice_date,
    billing,
  };
}

/** Reads the deposit invoice back from Kill Bill and keeps the figures; unreachable billing keeps the last ones. */
async function readBackDeposit(row: EnquiryRow): Promise<"live" | "unreachable"> {
  if (!row.deposit_invoice_id) return "live";
  let invoice: Invoice;
  try {
    invoice = await getInvoice(row.deposit_invoice_id);
  } catch (error) {
    if (error instanceof HttpError && error.status === 503) return "unreachable";
    throw error;
  }
  row.deposit_amount_cents = invoice.amountCents;
  row.deposit_balance_cents = invoice.balanceCents;
  row.deposit_invoice_date = itemDate(invoice, milestoneDescription(1, reference(row)));
  await query(
    "UPDATE proposals SET deposit_amount_cents = $2, deposit_balance_cents = $3, deposit_invoice_date = $4 WHERE enquiry_id = $1",
    [row.id, invoice.amountCents, invoice.balanceCents, row.deposit_invoice_date],
  );
  return "live";
}

async function readProposal({ res, params }: Context): Promise<void> {
  const row = await enquiryRow(await proposalId(params.token ?? ""));
  assertOpenToProducer(row);
  const billing = await readBackDeposit(row);
  const month = row.production_month ?? "";
  sendJson(res, 200, {
    reference: reference(row),
    project_title: row.project_title,
    scope: row.scope,
    fee_cents: row.fee_cents,
    currency: "USD",
    production_month: month,
    production_month_label: monthLabel(month),
    month_open: (await monthState(month))?.open ?? false,
    milestones: milestoneView(row.milestone_cents ?? []),
    status: row.read_status,
    expires_at: row.expires_at?.toISOString(),
    deposit: depositView(row, billing),
  });
}

/** Unpaid, non-VOID invoices on the account that no accepted enquiry records as its deposit. */
async function voidOrphans(client: PoolClient, accountId: string): Promise<void> {
  const recorded = new Set((await query<{ deposit_invoice_id: string }>(
    `SELECT pp.deposit_invoice_id FROM proposals pp JOIN enquiries e ON e.id = pp.enquiry_id
     WHERE pp.killbill_account_id = $1 AND pp.deposit_invoice_id IS NOT NULL
       AND e.status IN ('accepted', 'deposit_paid', 'booked')`,
    [accountId],
    client,
  )).map((row) => row.deposit_invoice_id));
  for (const invoice of await accountInvoices(accountId)) {
    if (invoice.status !== "VOID" && invoice.balanceCents > 0 && !recorded.has(invoice.invoiceId)) {
      await voidInvoice(invoice.invoiceId);
    }
  }
}

async function acceptProposal({ res, json, params }: Context): Promise<void> {
  const id = await proposalId(params.token ?? "");
  let created: string | null = null;
  try {
    await transaction(async (client) => {
      const row = await enquiryRow(id, client, true);
      assertOpenToProducer(row);
      assertMove(row.read_status, "accepted");
      new Checker(asObject(json)).writable([]).done();
      const month = row.production_month ?? "";
      if (!(await lockMonth(client, month))?.open) {
        fail(409, "month_taken", `${monthLabel(month)} has just been booked by another production.`, { month });
      }
      const ref = reference(row);
      const zone = (await settings()).time_zone;
      const account = await ensureAccount({
        externalKey: `earshot-${ref}`, name: row.producer_name ?? "", email: row.producer_email ?? "", company: row.studio,
        timeZone: zone,
      });
      await voidOrphans(client, account.accountId);
      const description = milestoneDescription(1, ref);
      const deposit = await createChargeInvoice(account.accountId, row.milestone_cents?.[0] ?? 0, description, businessDate(new Date(), zone));
      created = deposit.invoiceId;
      await client.query(
        `UPDATE proposals SET killbill_account_id = $2, deposit_invoice_id = $3, deposit_invoice_number = $4,
           deposit_amount_cents = $5, deposit_balance_cents = $6, deposit_invoice_date = $7 WHERE enquiry_id = $1`,
        [id, account.accountId, deposit.invoiceId, deposit.invoiceNumber, deposit.amountCents, deposit.balanceCents,
          itemDate(deposit, description)],
      );
      await client.query("UPDATE enquiries SET status = 'accepted', version = version + 1 WHERE id = $1", [id]);
      await queueMail(client, heldLetter(terms(row), zone, deposit.invoiceNumber));
    });
  } catch (error) {
    if (created) await voidInvoice(created).catch(() => undefined);
    throw error;
  }
  const states = await deliverForEnquiry(id);
  const row = await enquiryRow(id);
  sendJson(res, 201, { status: "accepted", deposit: depositView(row, "live"), email: states.get("month_held") ?? "pending" });
}

/** Records the Kill Bill PURCHASE for the deposit (or adopts one Kill Bill already holds) and moves to deposit_paid. */
async function recordDeposit(id: string, body: Record<string, unknown>) {
  return transaction(async (client) => {
    const row = await enquiryRow(id, client, true);
    assertOpenToProducer(row);
    assertMove(row.read_status, "deposit_paid");
    const check = new Checker(body).writable(["payer_name", "amount_cents"]);
    check.singleLine("payer_name", 1, 120);
    const amount = check.integer("amount_cents", 0, Number.MAX_SAFE_INTEGER);
    if (!check.errors.amount_cents && amount !== row.deposit_amount_cents) {
      check.error("amount_cents", "The amount does not match the deposit invoice.");
    }
    check.done();
    const account = row.killbill_account_id ?? billingUnavailable();
    const invoiceId = row.deposit_invoice_id ?? billingUnavailable();
    const externalKey = `earshot-${reference(row)}-deposit`;
    let paymentId = await findPurchase(account, externalKey);
    if (!paymentId) {
      const invoice = await getInvoice(invoiceId);
      paymentId = invoice.balanceCents === 0
        ? await invoicePaymentId(invoiceId)
        : await payInvoice(account, invoiceId, invoice.balanceCents, externalKey);
    }
    const paidAt = new Date();
    await client.query(
      `UPDATE proposals SET deposit_payment_id = $2, deposit_paid_at = $3, deposit_balance_cents = 0 WHERE enquiry_id = $1`,
      [id, paymentId, paidAt],
    );
    await client.query("UPDATE enquiries SET status = 'deposit_paid', version = version + 1 WHERE id = $1", [id]);
    await queueMail(client, depositLetter(terms(row), row.deposit_amount_cents ?? 0, row.deposit_invoice_number ?? ""));
    return {
      status: "deposit_paid",
      payment_id: paymentId,
      invoice_number: row.deposit_invoice_number,
      amount_cents: row.deposit_amount_cents,
      paid_at: paidAt.toISOString(),
    };
  });
}

async function payDeposit({ req, res, json, params }: Context): Promise<void> {
  const id = await proposalId(params.token ?? "");
  const key = idempotencyKey(req, true) ?? "";
  const body = asObject(json);
  await idempotent(res, { scope: `deposit:${id}`, key, fingerprint: fingerprint(body) }, (status) => status !== 503, async () => {
    const paid = await recordDeposit(id, body);
    const states = await deliverForEnquiry(id);
    return { status: 200, body: { ...paid, email: states.get("deposit") ?? "pending" } };
  });
}

export const proposalRoutes: Route[] = [
  { pattern: "/api/console/milestones/preview", methods: { POST: { handler: preview } } },
  { pattern: "/api/console/enquiries/:id/proposal", methods: { POST: { handler: sendProposal } } },
  { pattern: "/api/console/enquiries/:id/milestones/:n/invoice", methods: { POST: { handler: invoiceMilestone } } },
  { pattern: "/api/proposals/:token", methods: { GET: { handler: readProposal } } },
  { pattern: "/api/proposals/:token/accept", methods: { POST: { handler: acceptProposal } } },
  { pattern: "/api/proposals/:token/deposit", methods: { POST: { handler: payDeposit } } },
];
