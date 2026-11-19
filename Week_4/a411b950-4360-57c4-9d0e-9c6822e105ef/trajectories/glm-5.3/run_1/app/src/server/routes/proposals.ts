import { Context, Earshot } from "../context.js";
import { RouteContext } from "../http-core.js";
import {
  AppError,
  billingUnavailable,
  conflict,
  notFound,
  validationError,
} from "../errors.js";
import { sha256Hex } from "../crypto.js";
import { displayAddress } from "../mailer.js";
import { formatInstant, monthLabel } from "../../shared/dates.js";
import { Milestone } from "../../shared/domain.js";
import { KillBillUnavailable, KillBillError } from "../killbill.js";
import { ProposalRow } from "./records.js";

/**
 * Producer proposal API: read, accept, pay deposit (DP-25 to DP-32, DP-49,
 * DP-50, DP-55, DP-62).
 */

export function proposalApi(context: Context): void {
  const { app, router } = context;

  router.add("GET", "/api/proposals/:token", async (route) => readProposal(app, route.params.token));

  router.add("POST", "/api/proposals/:token/accept", async (route) =>
    acceptProposal(app, route.params.token),
  );

  router.add("POST", "/api/proposals/:token/deposit", async (route) =>
    payDeposit(app, route.params.token, route),
  );
}

interface ProposalView {
  reference: string;
  project_title: string;
  scope: string;
  fee_cents: number;
  currency: "USD";
  production_month: string;
  production_month_label: string;
  month_open: boolean;
  milestones: Milestone[];
  status: string;
  expires_at: string;
  deposit: DepositView | null;
}

interface DepositView {
  invoice_number: string;
  killbill_invoice_id: string;
  amount_cents: number;
  balance_cents: number;
  paid: boolean;
  invoice_date: string;
  billing: "live" | "unreachable";
}

async function loadProposal(app: Earshot, token: string): Promise<ProposalRow> {
  const rows = await app.db.query<ProposalRow>(
    `SELECT p.*, e.status AS enquiry_status, e.reference AS enquiry_reference
       FROM proposals p JOIN enquiries e ON e.id = p.enquiry_id
      WHERE p.token = $1`,
    [token],
  );
  if (rows.length === 0) throw notFound("This proposal does not exist.");
  return rows[0];
}

function readTimeStatus(row: ProposalRow): string {
  if (row.enquiry_status === "proposal_sent" && !row.accepted_at) {
    if (new Date(row.expires_at).getTime() <= Date.now()) return "expired";
  }
  return row.enquiry_status;
}

async function buildView(app: Earshot, row: ProposalRow): Promise<ProposalView> {
  const status = readTimeStatus(row);
  const month = await app.store.monthRecord(row.production_month);
  const milestones: Milestone[] = [
    { number: 1, name: "Deposit", percent: 30, amount_cents: row.m1_cents },
    { number: 2, name: "Vertical slice", percent: 20, amount_cents: row.m2_cents },
    { number: 3, name: "Content complete", percent: 20, amount_cents: row.m3_cents },
    { number: 4, name: "Final delivery", percent: 30, amount_cents: row.m4_cents },
  ];
  let deposit: DepositView | null = null;
  if (row.kb_deposit_invoice_id && row.kb_deposit_invoice_number) {
    deposit = await depositView(app, row);
  }
  return {
    reference: row.enquiry_reference || "",
    project_title: row.project_title,
    scope: row.scope,
    fee_cents: row.fee_cents,
    currency: "USD",
    production_month: row.production_month,
    production_month_label: monthLabel(row.production_month, ""),
    month_open: month.open,
    milestones,
    status,
    expires_at: new Date(row.expires_at).toISOString(),
    deposit,
  };
}

async function depositView(app: Earshot, row: ProposalRow): Promise<DepositView> {
  if (!row.kb_deposit_invoice_id || !row.kb_deposit_invoice_number) {
    throw new Error("Deposit invoice missing");
  }
  try {
    const invoice = await app.killbill.getInvoice(row.kb_deposit_invoice_id);
    return {
      invoice_number: invoice.invoiceNumber,
      killbill_invoice_id: invoice.invoiceId,
      amount_cents: invoice.amountCents,
      balance_cents: invoice.balanceCents,
      paid: invoice.balanceCents === 0,
      invoice_date: invoice.itemStartDate || "",
      billing: "live",
    };
  } catch (error) {
    if (error instanceof KillBillUnavailable) {
      // Kill Bill unreachable: the read still answers 200 with the last values
      // read back (DP-50).
      return {
        invoice_number: row.kb_deposit_invoice_number,
        killbill_invoice_id: row.kb_deposit_invoice_id,
        amount_cents: row.kb_deposit_amount_cents ?? 0,
        balance_cents: row.kb_deposit_amount_cents ?? 0,
        paid: false,
        invoice_date: row.kb_deposit_item_date || "",
        billing: "unreachable",
      };
    }
    throw error;
  }
}

async function readProposal(app: Earshot, token: string): Promise<unknown> {
  const row = await loadProposal(app, token);
  const status = readTimeStatus(row);
  if (status === "expired") {
    return {
      status: 410,
      body: { error: "proposal_expired", message: "This proposal has expired. Ask Kettlehole Audio for a new one." },
    };
  }
  if (status === "declined") {
    return {
      status: 410,
      body: { error: "proposal_closed", message: "This proposal is no longer open." },
    };
  }
  const view = await buildView(app, row);
  return { status: 200, body: view };
}

// ---------------------------------------------------------------------------
// Acceptance (DP-28 to DP-30, DP-49)
// ---------------------------------------------------------------------------

async function acceptProposal(app: Earshot, token: string): Promise<unknown> {
  const row = await loadProposal(app, token);
  const status = readTimeStatus(row);
  if (status === "expired") {
    return {
      status: 410,
      body: { error: "proposal_expired", message: "This proposal has expired. Ask Kettlehole Audio for a new one." },
    };
  }
  if (status === "declined") {
    return {
      status: 410,
      body: { error: "proposal_closed", message: "This proposal is no longer open." },
    };
  }
  if (status !== "proposal_sent") {
    throw conflict("illegal_transition", "That move isn't allowed from the current state.", {
      from: status,
      to: "accepted",
    });
  }

  // The acceptance is one unit of work: lock the enquiry, then the month, do
  // the Kill Bill work, then move the enquiry (DP: Acceptance).
  const result = await app.db.transaction(async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`enquiry:${row.enquiry_id}`]);
    const current = (
      await client.query<{ status: string; accepted_at: string | null }>(
        `SELECT e.status, p.accepted_at FROM enquiries e JOIN proposals p ON p.enquiry_id = e.id WHERE e.id = $1`,
        [row.enquiry_id],
      )
    ).rows[0];
    if (current.status !== "proposal_sent" || current.accepted_at) {
      throw conflict("illegal_transition", "That move isn't allowed from the current state.", {
        from: current.status,
        to: "accepted",
      });
    }
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      await client.query(`UPDATE enquiries SET status = 'expired' WHERE id = $1`, [row.enquiry_id]);
      throw conflict("illegal_transition", "That move isn't allowed from the current state.", {
        from: "expired",
        to: "accepted",
      });
    }
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`month:${row.production_month}`]);
    const claimed = Number(
      (
        await client.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM enquiries e JOIN proposals p ON p.enquiry_id = e.id
            WHERE p.production_month = $1 AND e.status IN ('accepted', 'deposit_paid', 'booked')`,
          [row.production_month],
        )
      ).rows[0].count,
    );
    const capacity = Number(
      (
        await client.query<{ capacity: number | null }>(
          `SELECT capacity FROM production_months WHERE month = $1`,
          [row.production_month],
        )
      ).rows[0]?.capacity ?? 0,
    );
    if (claimed >= capacity) {
      throw conflict("month_taken", "That production month has just been booked by another production.", {
        month: row.production_month,
      });
    }

    const settings = await app.store.readSettings();
    const enquiry = (
      await client.query<{ reference: string; studio: string }>(`SELECT reference, studio FROM enquiries WHERE id = $1`, [
        row.enquiry_id,
      ])
    ).rows[0];

    // Kill Bill account: find by external key, create when missing (DP: The
    // Kill Bill account).
    let accountId: string | null = null;
    try {
      const account = await app.killbill.ensureAccount({
        externalKey: `earshot-${enquiry.reference}`,
        name: row.producer_name,
        email: row.producer_email,
        company: enquiry.studio,
        timeZone: settings.time_zone,
      });
      accountId = account.accountId;
    } catch (error) {
      if (error instanceof KillBillUnavailable) throw billingUnavailable();
      throw error;
    }

    // Void orphaned deposit invoices before creating the new one (DP-30). An
    // orphaned invoice is any unpaid, non-VOID invoice on the account that no
    // accepted enquiry records as its deposit.
    try {
      const invoices = await app.killbill.listInvoices(accountId);
      const depositDescription = `Milestone 1 of 4: Deposit (${enquiry.reference})`;
      const linkedInvoices = new Set(
        (
          await client.query<{ kb_deposit_invoice_id: string | null; kb_milestone_invoice_ids: string[] }>(
            `SELECT kb_deposit_invoice_id, kb_milestone_invoice_ids FROM proposals WHERE enquiry_id = $1`,
            [row.enquiry_id],
          )
        ).rows
          .flatMap((record) => [record.kb_deposit_invoice_id, ...(record.kb_milestone_invoice_ids || [])])
          .filter((id): id is string => id !== null),
      );
      for (const invoice of invoices) {
        if (invoice.status === "VOID" || linkedInvoices.has(invoice.invoiceId)) continue;
        if (invoice.balanceCents === 0) continue;
        const isDepositItem = invoice.itemDescriptions.some((item) => item.description === depositDescription);
        if (isDepositItem) {
          try {
            await app.killbill.voidInvoice(invoice.invoiceId);
          } catch (voidError) {
            // An orphan another attempt already settled cannot be voided; the
            // read-back below reports whatever Kill Bill holds.
            if (!(voidError instanceof KillBillError)) throw voidError;
          }
        }
      }
    } catch (error) {
      if (error instanceof KillBillUnavailable) throw billingUnavailable();
      throw error;
    }

    // Create the deposit invoice, dated with the operator's local date (DP-59).
    const businessDate = await app.store.businessDate();
    let invoice;
    try {
      invoice = await app.killbill.createExternalChargeInvoice({
        accountId,
        description: `Milestone 1 of 4: Deposit (${enquiry.reference})`,
        amountCents: row.m1_cents,
        startDate: businessDate,
        autoCommit: true,
      });
    } catch (error) {
      if (error instanceof KillBillUnavailable) throw billingUnavailable();
      throw error;
    }

    // Moving the enquiry to accepted is what claims the month's place (DP-54).
    await client.query(`UPDATE enquiries SET status = 'accepted', version = version + 1 WHERE id = $1`, [
      row.enquiry_id,
    ]);
    await client.query(
      `UPDATE proposals SET accepted_at = now(), kb_account_id = $2, kb_deposit_invoice_id = $3,
          kb_deposit_invoice_number = $4, kb_deposit_item_date = $5, kb_deposit_amount_cents = $6
        WHERE enquiry_id = $1`,
      [row.enquiry_id, accountId, invoice.invoiceId, invoice.invoiceNumber, invoice.itemStartDate, invoice.amountCents],
    );
    return { accountId, invoice };
  });

  // Queue the month-held email once the claim stands (DP-28). The email is
  // rendered with the settings as they stand now.
  const settings = await app.store.readSettings();
  const monthLabelText = monthLabel(row.production_month, "");
  await app.mailQueue.queue({
    enquiryId: row.enquiry_id,
    kind: "month_held",
    recipient: displayAddress(row.producer_name, row.producer_email),
    subject: `${monthLabelText} held for ${row.project_title}: deposit due`,
    body: [
      `${monthLabelText} is now held for ${row.project_title}.`,
      ``,
      `Proposal ${row.enquiry_reference}: ${row.scope}`,
      ``,
      `Milestones:`,
      `  Deposit (30%): ${row.m1_cents / 100}`,
      `  Vertical slice (20%): ${row.m2_cents / 100}`,
      `  Content complete (20%): ${row.m3_cents / 100}`,
      `  Final delivery (30%): ${row.m4_cents / 100}`,
      ``,
      `Accept and pay the deposit at ${app.config.publicUrl}/p/${row.token}`,
      `This link stops working on ${formatInstant(new Date(row.expires_at), settings.time_zone)}.`,
      ``,
      `Kettlehole Audio`,
    ].join("\r\n"),
    from: app.config.smtp.from,
  });
  const emailState = await app.mailQueue.tryDeliverNewlyQueued(row.enquiry_id, "month_held");

  const fresh = await app.db.query<ProposalRow>(
    `SELECT p.*, e.status AS enquiry_status, e.reference AS enquiry_reference
       FROM proposals p JOIN enquiries e ON e.id = p.enquiry_id
      WHERE p.token = $1`,
    [token],
  );
  const deposit = await depositView(app, fresh[0]);
  return {
    status: 201,
    body: { status: "accepted", deposit, email: emailState },
  };
}

// ---------------------------------------------------------------------------
// Deposit payment (DP-31, DP-32, DP-50, DP-55)
// ---------------------------------------------------------------------------

async function payDeposit(app: Earshot, token: string, route: RouteContext): Promise<unknown> {
  const row = await loadProposal(app, token);
  const status = readTimeStatus(row);
  if (status === "expired") {
    return {
      status: 410,
      body: { error: "proposal_expired", message: "This proposal has expired. Ask Kettlehole Audio for a new one." },
    };
  }
  if (status === "declined") {
    return {
      status: 410,
      body: { error: "proposal_closed", message: "This proposal is no longer open." },
    };
  }

  let body: { payer_name?: unknown; amount_cents?: unknown };
  try {
    body = JSON.parse(route.body.toString("utf-8")) as { payer_name?: unknown; amount_cents?: unknown };
  } catch {
    throw validationError({ body: "Send the payment as JSON." });
  }
  const keyHeader = singleHeader(route.request.headers["idempotency-key"]);
  const errors: Record<string, string> = {};
  let key: string | null = null;
  if (keyHeader === undefined || keyHeader === "") {
    errors["Idempotency-Key"] = "Send a key of 1 to 100 visible ASCII characters.";
  } else {
    key = visibleAscii(keyHeader);
    if (key === null) {
      errors["Idempotency-Key"] = "Send a key of 1 to 100 visible ASCII characters.";
    }
  }
  if (typeof body.payer_name !== "string" || charCountOf(body.payer_name) < 1 || charCountOf(body.payer_name) > 120) {
    errors.payer_name = "Enter a name on one line, up to 120 characters.";
  } else if (!isSingleLine(body.payer_name)) {
    errors.payer_name = "Enter a name on one line, up to 120 characters.";
  }
  if (!isInteger(body.amount_cents)) {
    errors.amount_cents = "Send the deposit amount in whole cents.";
  }
  if (Object.keys(errors).length > 0) throw validationError(errors);

  const fingerprint = sha256Hex(`${body.payer_name}|${body.amount_cents}`);
  if (key) {
    const replay = await findDepositReplay(app, key, row.enquiry_id, fingerprint);
    if (replay.outcome === "stored") {
      return { status: replay.status, body: replay.body };
    }
    if (replay.outcome === "conflict") {
      throw conflict("idempotency_conflict", "That key was used for a different payment.");
    }
    if (replay.outcome === "in_progress") {
      throw conflict("request_in_progress", "That payment is still being recorded.");
    }
  }

  if (status !== "accepted" && status !== "deposit_paid" && status !== "booked") {
    if (status === "proposal_sent") {
      throw conflict("illegal_transition", "That move isn't allowed from the current state.", {
        from: "proposal_sent",
        to: "deposit_paid",
      });
    }
    throw conflict("illegal_transition", "That move isn't allowed from the current state.", {
      from: status,
      to: "deposit_paid",
    });
  }

  const amountCents = body.amount_cents as number;

  try {
    return await recordDepositPayment(app, row, {
      payerName: body.payer_name as string,
      amountCents,
      fingerprint,
      key,
      status,
    });
  } catch (error) {
    if (error instanceof KillBillUnavailable) {
      throw billingUnavailable();
    }
    throw error;
  }
}

async function recordDepositPayment(
  app: Earshot,
  row: ProposalRow,
  input: { payerName: string; amountCents: number; fingerprint: string; key: string | null; status: string },
): Promise<unknown> {
  const claimed = await app.db.transaction(async (client) => {
    if (!input.key) return 1;
    const result = await client.query(
      `INSERT INTO idempotency_deposits (key, proposal_enquiry_id, state, fingerprint, status, body)
       VALUES ($1, $2, 'in_progress', $3, 0, 'null')
       ON CONFLICT (key) DO NOTHING`,
      [input.key, row.enquiry_id, input.fingerprint],
    );
    return result.rowCount ?? 0;
  });
  if (claimed === 0 && input.key) {
    const replay = await findDepositReplay(app, input.key, row.enquiry_id, input.fingerprint);
    if (replay.outcome === "stored") {
      return { status: replay.status, body: replay.body };
    }
    if (replay.outcome === "conflict") {
      throw conflict("idempotency_conflict", "That key was used for a different payment.");
    }
    if (replay.outcome === "in_progress") {
      throw conflict("request_in_progress", "That payment is still being recorded.");
    }
  }

  let storedKey = false;
  try {
    const result = await performDeposit(app, row, input);
    if (input.key) {
      storedKey = true;
      await storeDepositResponse(app, input.key, row.enquiry_id, input.fingerprint, result.status, result.body);
    }
    return result;
  } catch (error) {
    if (input.key && !(error instanceof AppError && error.status === 503)) {
      await app.db.query(`DELETE FROM idempotency_deposits WHERE key = $1`, [input.key]);
    }
    throw error;
  }
}

async function performDeposit(
  app: Earshot,
  row: ProposalRow,
  input: { payerName: string; amountCents: number; fingerprint: string; key: string | null; status: string },
): Promise<{ status: number; body: Record<string, unknown> }> {
  return app.db.transaction(async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`enquiry:${row.enquiry_id}`]);
    const current = (
      await client.query<{ status: string; paid_at: string | null }>(
        `SELECT e.status, p.paid_at FROM enquiries e JOIN proposals p ON p.enquiry_id = e.id WHERE e.id = $1`,
        [row.enquiry_id],
      )
    ).rows[0];
    if (current.status === "deposit_paid" || current.status === "booked") {
      if (input.status === "accepted") {
        // Another tab paid while this request was in flight; adopt the state.
        const fresh = (
          await client.query<{ payment_id: string | null; paid_at: string | null }>(
            `SELECT payment_id, paid_at FROM proposals WHERE enquiry_id = $1`,
            [row.enquiry_id],
          )
        ).rows[0];
        return {
          status: 200,
          body: {
            status: "deposit_paid",
            payment_id: fresh.payment_id,
            invoice_number: row.kb_deposit_invoice_number,
            amount_cents: row.m1_cents,
            paid_at: fresh.paid_at ? new Date(fresh.paid_at).toISOString() : null,
            email: "pending",
          },
        };
      }
      if (input.key) {
        // A new key after the deposit is paid answers the transition error.
        throw conflict("illegal_transition", "That move isn't allowed from the current state.", {
          from: current.status,
          to: "deposit_paid",
        });
      }
    }
    if (current.status !== "accepted") {
      throw conflict("illegal_transition", "That move isn't allowed from the current state.", {
        from: current.status,
        to: "deposit_paid",
      });
    }
    if (!row.kb_deposit_invoice_id) {
      throw notFound("The deposit invoice is missing.");
    }
    const invoice = await app.killbill.getInvoice(row.kb_deposit_invoice_id);
    if (input.amountCents !== invoice.amountCents) {
      throw validationError({ amount_cents: "Send the deposit amount in whole cents." });
    }
    const reference = row.enquiry_reference || "";
    const existing = await app.killbill.findPaymentByExternalKey(`earshot-${reference}-deposit`);
    let paymentId: string;
    let paidAt: string;
    if (existing) {
      paymentId = existing.paymentId;
      paidAt = new Date().toISOString();
    } else if (invoice.balanceCents === 0) {
      const payments = await app.killbill.listInvoicePayments(invoice.invoiceId);
      if (payments.length === 0) {
        throw notFound("The deposit payment could not be found.");
      }
      paymentId = payments[0];
      paidAt = new Date().toISOString();
    } else {
      const payment = await app.killbill.recordPurchase({
        accountId: invoice.accountId,
        invoiceId: invoice.invoiceId,
        amountCents: invoice.balanceCents,
        externalKey: `earshot-${reference}-deposit`,
      });
      paymentId = payment.paymentId;
      paidAt = new Date().toISOString();
    }
    const emailQueuedBefore = await paymentEmailQueued(app, row.enquiry_id);
    await client.query(`UPDATE enquiries SET status = 'deposit_paid', version = version + 1 WHERE id = $1`, [
      row.enquiry_id,
    ]);
    await client.query(`UPDATE proposals SET payment_id = $2, paid_at = $3 WHERE enquiry_id = $1`, [
      row.enquiry_id,
      paymentId,
      paidAt,
    ]);
    let emailState: "sent" | "pending" = "pending";
    if (!emailQueuedBefore) {
      await queueDepositEmail(app, row);
    }
    emailState = await app.mailQueue.tryDeliverNewlyQueued(row.enquiry_id, "deposit");
    return {
      status: 200,
      body: {
        status: "deposit_paid",
        payment_id: paymentId,
        invoice_number: invoice.invoiceNumber,
        amount_cents: invoice.amountCents,
        paid_at: paidAt,
        email: emailState,
      },
    };
  });
}

async function paymentEmailQueued(app: Earshot, enquiryId: string): Promise<boolean> {
  const rows = await app.db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM mail_queue WHERE enquiry_id = $1 AND kind = 'deposit'`,
    [enquiryId],
  );
  return Number(rows[0].count) > 0;
}

async function queueDepositEmail(app: Earshot, row: ProposalRow): Promise<void> {
  const settings = await app.store.readSettings();
  const label = monthLabel(row.production_month, "");
  await app.mailQueue.queue({
    enquiryId: row.enquiry_id,
    kind: "deposit",
    recipient: displayAddress(row.producer_name, row.producer_email),
    subject: `Deposit received: ${label} confirmed for ${row.project_title}`,
    body: [
      `Your deposit for ${row.project_title} has been received.`,
      ``,
      `Production month: ${label}`,
      `Proposal ${row.enquiry_reference}.`,
      ``,
      `Kettlehole Audio`,
    ].join("\r\n"),
    from: app.config.smtp.from,
  });
  void settings;
}

function singleHeader(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

function visibleAscii(value: string): string | null {
  if (value.length < 1 || value.length > 100) return null;
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code < 0x20 || code > 0x7e) return null;
  }
  return value;
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function charCountOf(text: string): number {
  return Array.from(text).length;
}

function isSingleLine(text: string): boolean {
  return !/[\u0000-\u001F\u007F\u2028\u2029]/.test(text);
}

type DepositReplay =
  | { outcome: "none" }
  | { outcome: "stored"; status: number; body: unknown }
  | { outcome: "conflict" }
  | { outcome: "in_progress" };

async function findDepositReplay(
  app: Earshot,
  key: string,
  enquiryId: string,
  fingerprint: string,
): Promise<DepositReplay> {
  const rows = await app.db.query<{
    proposal_enquiry_id: string;
    state: string;
    status: number;
    body: unknown;
    fingerprint: string;
  }>(`SELECT * FROM idempotency_deposits WHERE key = $1`, [key]);
  if (rows.length === 0) return { outcome: "none" };
  const row = rows[0];
  if (row.proposal_enquiry_id !== enquiryId) return { outcome: "conflict" };
  if (row.state === "in_progress") return { outcome: "in_progress" };
  if (row.fingerprint !== fingerprint) return { outcome: "conflict" };
  const body = typeof row.body === "string" ? JSON.parse(row.body) : row.body;
  return { outcome: "stored", status: row.status, body };
}

async function storeDepositResponse(
  app: Earshot,
  key: string,
  enquiryId: string,
  fingerprint: string,
  status: number,
  body: unknown,
): Promise<void> {
  await app.db.query(
    `INSERT INTO idempotency_deposits (key, proposal_enquiry_id, state, fingerprint, status, body)
     VALUES ($1, $2, 'stored', $3, $4, $5)
     ON CONFLICT (key) DO UPDATE SET state = 'stored', fingerprint = $3, status = $4, body = $5`,
    [key, enquiryId, fingerprint, status, JSON.stringify(body)],
  );
}
