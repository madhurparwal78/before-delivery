import type { App } from './app';
import { ApiError } from './errors';
import {
  newId, loadEngagementRow, buildQuote, serializeInvoice, serializeLedger,
  quoteFxLine, formatUtcDate, formatUtcTime,
} from './domain';
import { convertGbpMinor, vatAmount, formatMoney, CURRENCIES } from './money';
import { MILESTONE_LABELS } from './types';
import type { EngagementRow } from './domain';
import type { CurrencyCode, Milestone, TestCard } from './types';
import { APPROVING_CARD, DECLINING_CARD } from './types';

/**
 * Billing orchestration: deposit, invoice payments, cancellation refunds.
 * The card check, refund allocation and the refund transaction key live here.
 */

export const REFUND_KEY_PREFIX = ':refund:';

export function cardKey(number: string): 'approve' | 'decline' | null {
  const normalized = number.replace(/ /g, '');
  if (normalized === APPROVING_CARD) {
    return 'approve';
  }
  if (normalized === DECLINING_CARD) {
    return 'decline';
  }
  return null;
}

export function validateCard(card: TestCard): ApiError | null {
  const number = card.number.replace(/ /g, '');
  if (cardKey(number) === null) {
    return new ApiError('validation_failed', { 'card.number': 'Use one of the studio\'s test cards.' });
  }
  if (!/^\d{2}\/\d{2}$/.test(card.expiry)) {
    return new ApiError('validation_failed', { 'card.expiry': 'Enter an expiry date in the future.' });
  }
  const [monthText, yearText] = card.expiry.split('/');
  const month = Number.parseInt(monthText, 10);
  const year = Number.parseInt(yearText, 10);
  if (month < 1 || month > 12 || !Number.isFinite(month) || !Number.isFinite(year)) {
    return new ApiError('validation_failed', { 'card.expiry': 'Enter an expiry date in the future.' });
  }
  const now = new Date();
  const currentYear = now.getUTCFullYear() % 100;
  const currentMonth = now.getUTCMonth() + 1;
  if (year < currentYear || (year === currentYear && month < currentMonth)) {
    return new ApiError('validation_failed', { 'card.expiry': 'Enter an expiry date in the future.' });
  }
  if (!/^\d{3}$/.test(card.cvc)) {
    return new ApiError('validation_failed', { 'card.cvc': 'Enter the 3-digit security code.' });
  }
  if (typeof card.name !== 'string' || card.name.trim().length === 0) {
    return new ApiError('validation_failed', { 'card.name': 'Enter the name on the card.' });
  }
  return null;
}

export interface CardValidationResult {
  decline: boolean;
}

export function checkCard(card: TestCard): CardValidationResult {
  const invalid = validateCard(card);
  if (invalid) {
    throw invalid;
  }
  return { decline: cardKey(card.number.replace(/ /g, '')) === 'decline' };
}

export async function ensureKillBillAccount(app: App, engagement: EngagementRow, financeEmail: string): Promise<string> {
  const existing = await app.killbill.findAccountByExternalKey(engagement.brand_id);
  if (existing) {
    return existing;
  }
  return app.killbill.createAccount(engagement.brand_id, engagement.brand_name, financeEmail, engagement.brand_currency);
}

export async function brandFinanceEmail(app: App, brandId: string): Promise<string> {
  const result = await app.pool.query(
    `SELECT email FROM contacts WHERE brand_id = $1 AND role = 'finance' LIMIT 1`,
    [brandId],
  );
  if (result.rows.length > 0) {
    return result.rows[0].email as string;
  }
  const owner = await app.pool.query(
    `SELECT email FROM contacts WHERE brand_id = $1 AND role = 'owner' LIMIT 1`,
    [brandId],
  );
  return owner.rows[0].email as string;
}

export async function brandReviewerEmail(app: App, brandId: string): Promise<string> {
  const result = await app.pool.query(
    `SELECT email FROM contacts WHERE brand_id = $1 AND role = 'reviewer' LIMIT 1`,
    [brandId],
  );
  if (result.rows.length > 0) {
    return result.rows[0].email as string;
  }
  const owner = await app.pool.query(
    `SELECT email FROM contacts WHERE brand_id = $1 AND role = 'owner' LIMIT 1`,
    [brandId],
  );
  return owner.rows[0].email as string;
}

/** Change-order amount at the locked rate: £180 net + 20% VAT rounded half up. */
export function changeOrderAmountMinor(rate: string, currency: CurrencyCode): number {
  const net = convertGbpMinor(18000, rate, currency);
  const vat = vatAmount(BigInt(net), currency);
  return Number(net + vat);
}

export function changeOrderDescription(milestone: Milestone, round: number, reference: string): string {
  const label = MILESTONE_LABELS[milestone];
  return `Change order, ${label} round ${round}, ${reference}`;
}

export function shareLineDescription(milestone: Milestone, reference: string): string {
  return `${MILESTONE_LABELS[milestone]} ${reference}`;
}

/**
 * The deposit: lock rate/titles/prices, charge, record invoice and payment,
 * send receipt, write ledger entry and queue the push. All or nothing.
 */
export async function payDeposit(app: App, engagementId: string, card: TestCard): Promise<{ engagementId: string; invoiceId: string; ledgerEntryId: string }> {
  const engagement = await loadEngagementRow(app.pool, engagementId);
  if (engagement === null) {
    throw new ApiError('not_found');
  }
  // Preconditions in order, all judged before Kill Bill is contacted.
  if (engagement.state !== 'quoted') {
    throw new ApiError('invalid_state');
  }
  const quote = await buildQuote(app, engagement);
  if (quote.lines.length === 0) {
    throw new ApiError('quote_empty');
  }
  const currentModel = await currentModelRow(app.pool, engagementId);
  if (currentModel === null || currentModel.measurement === 'failed') {
    throw new ApiError('model_missing');
  }
  if (currentModel.measurement !== 'measured') {
    throw new ApiError('measurement_pending');
  }
  if (currentModel.unit_needed && !currentModel.unit_confirmed) {
    throw new ApiError('unit_unconfirmed');
  }
  const decline = checkCard(card).decline;
  if (decline) {
    throw new ApiError('card_declined');
  }

  const depositMinor = quote.milestones.deposit_minor;
  const currency = engagement.brand_currency;
  const exponent = CURRENCIES[currency].exponent;
  const paidAt = new Date();
  const financeEmail = await brandFinanceEmail(app, engagement.brand_id);

  // Billing must be up before we start.
  let accountId: string;
  try {
    accountId = await ensureKillBillAccount(app, engagement, financeEmail);
  } catch {
    throw new ApiError('billing_unavailable');
  }

  // Snapshot the rate in effect at payment moment for the lock.
  const { rateInEffect } = await import('./domain');
  let lockedRate = engagement.fx_rate;
  if (currency !== 'GBP') {
    try {
      lockedRate = await rateInEffect(app.pool, currency, paidAt);
    } catch {
      lockedRate = engagement.fx_rate;
    }
  }
  const lockedQuote = await buildQuoteWithRate(app, engagement, lockedRate);

  const shareDescription = shareLineDescription('deposit', engagement.reference);
  let killbillInvoiceId: string;
  let killbillNumber: string;
  let paymentId: string;
  let invoiceId = newId();
  let ledgerEntryId = newId();
  const paymentExternalKey = `${engagement.id}:deposit:${newId()}`;

  const client = await app.pool.connect();
  try {
    await client.query('BEGIN');
    // Concurrency: exactly one deposit wins.
    const claim = await client.query(
      `UPDATE engagements SET state = 'deposit_paid', fx_rate = $2, fx_locked_at = $3, quote_locked = TRUE
       WHERE id = $1 AND state = 'quoted' RETURNING id`,
      [engagement.id, lockedRate, paidAt.toISOString()],
    );
    if (claim.rows.length === 0) {
      await client.query('ROLLBACK');
      throw new ApiError('invalid_state');
    }
    // Lock titles and prices on the lines.
    const lines = await client.query(
      `SELECT shot_code FROM quote_lines WHERE engagement_id = $1`,
      [engagement.id],
    );
    const { loadServices } = await import('./domain');
    const services = await loadServices(app);
    for (const line of lines.rows) {
      const service = services.find(s => s.code === line.shot_code);
      if (service) {
        await client.query(
          `UPDATE quote_lines SET locked_title = $2, locked_price_pence = $3 WHERE engagement_id = $1 AND shot_code = $4`,
          [engagement.id, service.title, service.list_price_pence, line.shot_code],
        );
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  // Kill Bill invoice + payment (outside the transaction; undone on failure).
  try {
    const invoice = await app.killbill.createInvoice(
      accountId, currency, exponent,
      [{ description: shareDescription, amount: depositMinor }],
      `${engagement.id}:deposit`,
    );
    killbillInvoiceId = invoice.invoiceId;
    killbillNumber = invoice.invoiceNumber;
    const payment = await app.killbill.purchase(
      killbillInvoiceId, accountId, currency, exponent, depositMinor, paymentExternalKey,
    );
    paymentId = payment.paymentId;
  } catch {
    await undoDeposit(app, engagement.id);
    throw new ApiError('billing_unavailable');
  }

  // Receipt PDF (documents outage tolerated).
  const receiptPdf = await renderDepositReceiptPdf(app, engagement, lockedQuote, depositMinor, financeEmail);

  // Record everything in one transaction.
  try {
    const writer = await app.pool.connect();
    try {
      await writer.query('BEGIN');
      const existing = await writer.query(
        `SELECT id FROM invoices WHERE engagement_id = $1 AND milestone = 'deposit'`,
        [engagement.id],
      );
      if (existing.rows.length > 0) {
        invoiceId = existing.rows[0].id as string;
        await writer.query(
          `UPDATE invoices SET status = 'paid', amount_minor = $2, balance_minor = 0, number = $3,
           killbill_invoice_id = $4, issued_at = $5, overdue_at = NULL WHERE id = $6`,
          [engagement.id, depositMinor, killbillNumber, killbillInvoiceId, paidAt.toISOString(), invoiceId],
        );
        await writer.query(`DELETE FROM invoice_lines WHERE invoice_id = $1`, [invoiceId]);
      } else {
        await writer.query(
          `INSERT INTO invoices (id, engagement_id, milestone, status, amount_minor, balance_minor, number, killbill_invoice_id, failed_attempts, issued_at, overdue_at)
           VALUES ($1, $2, 'deposit', 'paid', $3, 0, $4, $5, 0, $6, NULL)`,
          [invoiceId, engagement.id, depositMinor, killbillNumber, killbillInvoiceId, paidAt.toISOString()],
        );
      }
      await writer.query(
        `INSERT INTO invoice_lines (id, invoice_id, description, amount_minor) VALUES ($1, $2, $3, $4)`,
        [newId(), invoiceId, shareDescription, depositMinor],
      );
      const ledger = await writer.query(
        `INSERT INTO ledger_entries (id, engagement_id, kind, amount_minor, currency, invoice_id, killbill_payment_id, created_at)
         VALUES ($1, $2, 'deposit', $3, $4, $5, $6, $7) RETURNING *`,
        [ledgerEntryId, engagement.id, depositMinor, currency, invoiceId, paymentId, paidAt.toISOString()],
      );
      ledgerEntryId = ledger.rows[0].id as string;
      await writer.query(
        `INSERT INTO outbox (id, kind, payload) VALUES ($1, 'email', $2)`,
        [newId(), JSON.stringify({
          type: 'deposit_receipt',
          engagement_id: engagement.id,
          invoice_id: invoiceId,
          ledger_entry_id: ledgerEntryId,
          pdf: receiptPdf === null ? null : receiptPdf.toString('base64'),
        })],
      );
      await writer.query(
        `INSERT INTO outbox (id, kind, payload) VALUES ($1, 'push', $2)`,
        [newId(), JSON.stringify({ type: 'deposit_paid', engagement_id: engagement.id, invoice_id: invoiceId })],
      );
      await writer.query('COMMIT');
    } catch (error) {
      await writer.query('ROLLBACK');
      throw error;
    } finally {
      writer.release();
    }
  } catch (error) {
    await undoDeposit(app, engagement.id, killbillInvoiceId, killbillNumber, accountId, currency, exponent, depositMinor, paymentId);
    throw error instanceof ApiError ? error : new ApiError('billing_unavailable');
  }

  return { engagementId: engagement.id, invoiceId, ledgerEntryId };
}

async function buildQuoteWithRate(app: App, engagement: EngagementRow, rate: string) {
  const row = { ...engagement, fx_rate: rate };
  return buildQuote(app, row);
}

async function undoDeposit(app: App, engagementId: string): Promise<void>;
async function undoDeposit(
  app: App, engagementId: string, killbillInvoiceId: string, killbillNumber: string,
  accountId: string, currency: CurrencyCode, exponent: number, depositMinor: number, paymentId: string,
): Promise<void>;
async function undoDeposit(
  app: App, engagementId: string,
  killbillInvoiceId?: string, _killbillNumber?: string,
  accountId?: string, currency?: CurrencyCode, exponent?: number, depositMinor?: number, paymentId?: string,
): Promise<void> {
  const client = await app.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE engagements SET state = 'quoted', fx_locked_at = NULL, quote_locked = FALSE WHERE id = $1`,
      [engagementId],
    );
    await client.query(`UPDATE quote_lines SET locked_title = NULL, locked_price_pence = NULL WHERE engagement_id = $1`, [engagementId]);
    await client.query(
      `DELETE FROM invoices WHERE engagement_id = $1 AND milestone = 'deposit'`,
      [engagementId],
    );
    await client.query(
      `DELETE FROM ledger_entries WHERE engagement_id = $1 AND kind = 'deposit'`,
      [engagementId],
    );
    await client.query(
      `DELETE FROM outbox WHERE (payload->>'engagement_id') = $1 AND (payload->>'type') IN ('deposit_receipt','deposit_paid')`,
      [engagementId],
    );
    await client.query('COMMIT');
  } catch {
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
  if (killbillInvoiceId && accountId && paymentId) {
    try {
      await app.killbill.refund(paymentId, currency as CurrencyCode, exponent as number, depositMinor as number, `undo:${newId()}`);
      await app.killbill.voidInvoice(killbillInvoiceId);
    } catch {
      // best effort: the account keeps no unpaid balance because we void
    }
  }
}

export async function currentModelRow(pool: App['pool'], engagementId: string): Promise<Record<string, unknown> | null> {
  const result = await pool.query(
    `SELECT * FROM intake_files
     WHERE engagement_id = $1 AND kind = 'model' AND status = 'received'
     ORDER BY created_at DESC, id DESC LIMIT 1`,
    [engagementId],
  );
  return result.rows[0] ?? null;
}

/** Render the deposit receipt PDF; null when Gotenberg is unreachable. */
export async function renderDepositReceiptPdf(
  app: App, engagement: EngagementRow, quote: { lines: { title: string; quantity: number; amount_minor: number }[]; subtotal_minor: number; vat_minor: number; total_minor: number }, depositMinor: number, financeEmail: string,
): Promise<Buffer | null> {
  try {
    const html = receiptHtml(engagement, quote, depositMinor, financeEmail);
    return await app.documents.renderPdf(html);
  } catch {
    return null;
  }
}

export function receiptHtml(
  engagement: EngagementRow,
  quote: { lines: { title: string; quantity: number; amount_minor: number }[]; subtotal_minor: number; vat_minor: number; total_minor: number },
  depositMinor: number, _financeEmail: string,
): string {
  const currency = engagement.brand_currency;
  const symbol = CURRENCIES[currency].symbol;
  const exponent = CURRENCIES[currency].exponent;
  const rows = quote.lines.map(line => `
    <tr><td>${escapeHtml(line.title)} × ${line.quantity}</td><td class="num">${escapeHtml(formatMoney(line.amount_minor, currency))}</td></tr>`).join('');
  const rate = quoteFxLineForRate(engagement.fx_rate, currency, engagement.fx_locked_at);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body { font-family: sans-serif; color: #111; }
    h1 { font-size: 18px; }
    table { border-collapse: collapse; width: 100%; }
    td, th { padding: 4px 8px; border-bottom: 1px solid #ccc; text-align: left; }
    td.num, th.num { text-align: right; }
    .total { font-weight: bold; }
    .mono { font-family: monospace; }
  </style></head><body>
  <h1>Gloamwork Studio</h1>
  <p>Deposit receipt: ${escapeHtml(engagement.reference)}</p>
  <p>${escapeHtml(engagement.brand_name)}</p>
  <table>
    <tr><th>Line</th><th class="num">Amount</th></tr>
    ${rows}
    <tr><td>Subtotal</td><td class="num">${escapeHtml(formatMoney(quote.subtotal_minor, currency))}</td></tr>
    <tr><td>VAT (20%)</td><td class="num">${escapeHtml(formatMoney(quote.vat_minor, currency))}</td></tr>
    <tr><td class="total">Total</td><td class="num total">${escapeHtml(formatMoney(quote.total_minor, currency))}</td></tr>
  </table>
  <p>${escapeHtml(rate)}</p>
  <p>Deposit paid <span class="mono">${escapeHtml(formatMoney(depositMinor, currency))}</span></p>
  <p>Currency: ${currency} (${symbol}), ${exponent} decimals</p>
  </body></html>`;
}

export function invoiceHtml(
  engagement: EngagementRow,
  invoice: { number: string; lines: { description: string; amount_minor: number }[]; amount_minor: number },
  quote: { subtotal_minor: number; vat_minor: number; total_minor: number },
): string {
  const currency = engagement.brand_currency;
  const rows = invoice.lines.map(line => `
    <tr><td>${escapeHtml(line.description)}</td><td class="num">${escapeHtml(formatMoney(line.amount_minor, currency))}</td></tr>`).join('');
  const rate = quoteFxLineForRate(engagement.fx_rate, currency, engagement.fx_locked_at);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body { font-family: sans-serif; color: #111; }
    h1 { font-size: 18px; }
    table { border-collapse: collapse; width: 100%; }
    td, th { padding: 4px 8px; border-bottom: 1px solid #ccc; text-align: left; }
    td.num, th.num { text-align: right; }
    .total { font-weight: bold; }
  </style></head><body>
  <h1>Gloamwork Studio</h1>
  <p>Invoice ${escapeHtml(invoice.number)}: ${escapeHtml(engagement.reference)}</p>
  <p>${escapeHtml(engagement.brand_name)}</p>
  <table>
    <tr><th>Line</th><th class="num">Amount</th></tr>
    ${rows}
    <tr><td>Subtotal</td><td class="num">${escapeHtml(formatMoney(quote.subtotal_minor, currency))}</td></tr>
    <tr><td>VAT (20%)</td><td class="num">${escapeHtml(formatMoney(quote.vat_minor, currency))}</td></tr>
    <tr><td class="total">Total</td><td class="num total">${escapeHtml(formatMoney(quote.total_minor, currency))}</td></tr>
  </table>
  <p>${escapeHtml(rate)}</p>
  <p>Invoice <span class="mono">${escapeHtml(invoice.number)}</span></p>
  <p>Amount due <span class="mono">${escapeHtml(formatMoney(invoice.amount_minor, currency))}</span></p>
  </body></html>`;
}

function quoteFxLineForRate(rate: string, currency: CurrencyCode, lockedAt: Date | null): string {
  if (currency === 'GBP') {
    return 'Priced in GBP.';
  }
  const rateText = Number(rate).toFixed(4);
  if (lockedAt) {
    return `Locked at ${rateText} per £1 on ${formatUtcDate(lockedAt)}.`;
  }
  return `Indicative at ${rateText} per £1.`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
