import type { App } from './app';
import { formatMoney, CURRENCIES } from './money';
import {
  MILESTONE_LABELS,
} from './types';
import type { CurrencyCode, Milestone } from './types';
import { loadEngagementRow } from './domain';
import type { EngagementRow } from './domain';
import { brandFinanceEmail, escapeHtml } from './billing';
import { formatUtcDate, formatUtcTime } from './domain';

/**
 * Outbox delivery: every queued email and push is delivered exactly once,
 * within 30 seconds once its service accepts connections.
 */
export function startOutbox(app: App): void {
  let running = false;
  const tick = async (): Promise<void> => {
    if (running) {
      return;
    }
    running = true;
    try {
      const pending = await app.pool.query(
        `SELECT * FROM outbox WHERE delivered_at IS NULL ORDER BY created_at ASC LIMIT 10`,
      );
      for (const entry of pending.rows) {
        await deliverEntry(app, entry);
      }
    } catch {
      // database hiccup; next tick retries
    } finally {
      running = false;
    }
  };
  setInterval(tick, 5_000);
  void tick();
}

async function deliverEntry(app: App, entry: Record<string, unknown>): Promise<void> {
  const raw = entry.payload;
  const payload = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, unknown>;
  let delivered = false;
  try {
    if (entry.kind === 'email') {
      delivered = await deliverEmail(app, payload);
    } else if (entry.kind === 'push') {
      delivered = await deliverPush(app, payload);
    } else {
      delivered = true;
    }
  } catch {
    delivered = false;
  }
  if (delivered) {
    await app.pool.query(`UPDATE outbox SET delivered_at = now(), attempts = attempts + 1 WHERE id = $1`, [entry.id]);
  } else {
    await app.pool.query(`UPDATE outbox SET attempts = attempts + 1 WHERE id = $1`, [entry.id]);
  }
}

async function deliverEmail(app: App, payload: Record<string, unknown>): Promise<boolean> {
  const type = payload.type as string;
  if (type === 'sign_in_code') {
    const to = payload.email as string;
    const code = payload.code as string;
    await app.mail.send({
      to,
      subject: 'Your Gloamwork sign-in code',
      text: `Your Gloamwork sign-in code is ${code}. It expires soon.`,
      html: `<p>Your Gloamwork sign-in code is <strong>${escapeHtml(code)}</strong>.</p>`,
    });
    return true;
  }

  const engagementId = payload.engagement_id as string;
  const engagement = await loadEngagementRow(app.pool, engagementId);
  if (engagement === null) {
    return true;
  }
  const currency = engagement.brand_currency;
  const financeEmail = await brandFinanceEmail(app, engagement.brand_id);
  const publicOrigin = app.config.publicUrl;
  const engagementUrl = `${publicOrigin}/account/engagements/${engagement.id}`;

  if (type === 'deposit_receipt') {
    const invoiceId = payload.invoice_id as string;
    const invoice = await app.pool.query(`SELECT amount_minor FROM invoices WHERE id = $1`, [invoiceId]);
    const amountMinor = invoice.rows.length > 0 ? Number(invoice.rows[0].amount_minor) : (await (await import('./domain')).buildQuote(app, engagement)).milestones.deposit_minor;
    const pdfBase64 = payload.pdf as string | null;
    let attachment: { filename: string; content: Buffer; contentType: string } | undefined;
    if (pdfBase64) {
      attachment = {
        filename: `${engagement.reference}-deposit.pdf`,
        content: Buffer.from(pdfBase64, 'base64'),
        contentType: 'application/pdf',
      };
    }
    const linesText = await quoteLinesText(app, engagement);
    const linesHtml = await quoteLinesHtml(app, engagement);
    await app.mail.send({
      to: financeEmail,
      subject: `Deposit receipt: ${engagement.reference}`,
      text: `Deposit received for ${engagement.reference}.\n\n${linesText}\nA PDF receipt is attached.\n${engagementUrl}`,
      html: `<p>Deposit received for ${escapeHtml(engagement.reference)}.</p>${linesHtml}<p>A PDF receipt is attached.</p><p>${engagementUrl}</p>`,
      attachment,
    });
    return true;
  }

  if (type === 'invoice_issued') {
    const invoiceId = payload.invoice_id as string;
    const pdfBase64 = payload.pdf as string | null;
    const invoice = await app.pool.query(`SELECT * FROM invoices WHERE id = $1`, [invoiceId]);
    if (invoice.rows.length === 0) {
      return true;
    }
    const row = invoice.rows[0];
    let attachment: { filename: string; content: Buffer; contentType: string } | undefined;
    if (pdfBase64) {
      attachment = {
        filename: `${engagement.reference}-${row.number}.pdf`,
        content: Buffer.from(pdfBase64, 'base64'),
        contentType: 'application/pdf',
      };
    }
    const lines = await invoiceLinesText(app, invoiceId);
    await app.mail.send({
      to: financeEmail,
      subject: `Invoice ${row.number} issued: ${engagement.reference}`,
      text: `Invoice ${row.number} for ${engagement.reference}.\n\n${lines}\nA PDF invoice is attached.\n${engagementUrl}`,
      html: `<p>Invoice ${escapeHtml(String(row.number))} for ${escapeHtml(engagement.reference)}.</p>${lines}<p>A PDF invoice is attached.</p><p>${engagementUrl}</p>`,
      attachment,
    });
    return true;
  }

  if (type === 'invoice_receipt') {
    const invoiceId = payload.invoice_id as string;
    const invoice = await app.pool.query(`SELECT * FROM invoices WHERE id = $1`, [invoiceId]);
    if (invoice.rows.length === 0) {
      return true;
    }
    const row = invoice.rows[0];
    const amount = formatMoney(Number(row.amount_minor), currency);
    await app.mail.send({
      to: financeEmail,
      subject: `Receipt for invoice ${row.number}: ${engagement.reference}`,
      text: `Payment received for invoice ${row.number} of ${engagement.reference}: ${amount}.\n${engagementUrl}`,
      html: `<p>Payment received for invoice ${escapeHtml(String(row.number))} of ${escapeHtml(engagement.reference)}: ${escapeHtml(amount)}.</p><p>${engagementUrl}</p>`,
    });
    return true;
  }

  if (type === 'payment_failed') {
    const invoiceId = payload.invoice_id as string;
    const invoice = await app.pool.query(`SELECT * FROM invoices WHERE id = $1`, [invoiceId]);
    if (invoice.rows.length === 0) {
      return true;
    }
    const row = invoice.rows[0];
    const overdueAt = row.overdue_at ? new Date(row.overdue_at) : null;
    const payBy = overdueAt ? ` Pay by ${formatUtcDate(overdueAt)}, ${formatUtcTime(overdueAt)} UTC to avoid an overdue notice.` : '';
    await app.mail.send({
      to: financeEmail,
      subject: `Payment failed for invoice ${row.number}: ${engagement.reference}`,
      text: `Payment for invoice ${row.number} of ${engagement.reference} was declined.${payBy}\n${engagementUrl}`,
      html: `<p>Payment for invoice ${escapeHtml(String(row.number))} of ${escapeHtml(engagement.reference)} was declined.${escapeHtml(payBy)}</p><p>${engagementUrl}</p>`,
    });
    return true;
  }

  if (type === 'invoice_overdue') {
    const invoiceId = payload.invoice_id as string;
    const invoice = await app.pool.query(`SELECT * FROM invoices WHERE id = $1`, [invoiceId]);
    if (invoice.rows.length === 0) {
      return true;
    }
    const row = invoice.rows[0];
    const amount = formatMoney(Number(row.amount_minor), currency);
    await app.mail.send({
      to: financeEmail,
      subject: `Invoice ${row.number} is overdue: ${engagement.reference}`,
      text: `Invoice ${row.number} of ${engagement.reference} for ${amount} is overdue.\n${engagementUrl}`,
      html: `<p>Invoice ${escapeHtml(String(row.number))} of ${escapeHtml(engagement.reference)} for ${escapeHtml(amount)} is overdue.</p><p>${engagementUrl}</p>`,
    });
    return true;
  }

  if (type === 'review_link') {
    const reviewUrl = payload.review_url as string;
    const milestone = payload.milestone as Milestone;
    const expiresAt = new Date(payload.expires_at as string);
    const label = MILESTONE_LABELS[milestone];
    const subject = milestone === 'look_dev'
      ? `Look-dev stills ready for review: ${engagement.reference}`
      : `Final stills ready for review: ${engagement.reference}`;
    const reviewerEmail = payload.reviewer_email as string;
    await app.mail.send({
      to: reviewerEmail,
      subject,
      text: `${engagement.reference} — ${engagement.brand_name}\n${label}\n${reviewUrl}\nThis link works until ${formatUtcDate(expiresAt)}, ${formatUtcTime(expiresAt)} UTC.`,
      html: `<p>${escapeHtml(engagement.reference)} — ${escapeHtml(engagement.brand_name)}</p><p>${escapeHtml(label)}</p><p>${reviewUrl}</p><p>This link works until ${formatUtcDate(expiresAt)}, ${formatUtcTime(expiresAt)} UTC.</p>`,
    });
    return true;
  }

  if (type === 'refund') {
    const totalRefunded = Number(payload.total_refunded_minor);
    const parts = payload.parts as { killbill_payment_id: string; amount_minor: number }[];
    const amount = formatMoney(totalRefunded, currency);
    const partsText = parts.map(part => `- ${formatMoney(part.amount_minor, currency)}`).join('\n');
    await app.mail.send({
      to: financeEmail,
      subject: `Refund of ${amount}: ${engagement.reference}`,
      text: `Engagement ${engagement.reference} is cancelled. A refund of ${amount} has been recorded.\n\nParts:\n${partsText}\n\n${engagementUrl}`,
      html: `<p>Engagement ${escapeHtml(engagement.reference)} is cancelled. A refund of ${escapeHtml(amount)} has been recorded.</p><p>${engagementUrl}</p>`,
    });
    return true;
  }

  return true;
}

async function deliverPush(app: App, payload: Record<string, unknown>): Promise<boolean> {
  const type = payload.type as string;
  const engagementId = payload.engagement_id as string;
  const engagement = await loadEngagementRow(app.pool, engagementId);
  if (engagement === null) {
    return true;
  }
  const currency = engagement.brand_currency;
  if (type === 'deposit_paid') {
    const invoiceId = payload.invoice_id as string;
    const invoice = await app.pool.query(`SELECT * FROM invoices WHERE id = $1`, [invoiceId]);
    const amount = invoice.rows.length > 0 ? formatMoney(Number(invoice.rows[0].amount_minor), currency) : '';
    await app.alerts.push({
      title: 'Deposit paid',
      message: `${engagement.reference} · ${engagement.brand_name} · ${amount}`,
    });
    return true;
  }
  if (type === 'revision_requested') {
    const milestone = payload.milestone as Milestone;
    const round = Number(payload.round);
    await app.alerts.push({
      title: 'Revision requested',
      message: `${engagement.reference} · ${MILESTONE_LABELS[milestone]} round ${round}`,
    });
    return true;
  }
  if (type === 'invoice_overdue') {
    const invoiceId = payload.invoice_id as string;
    const invoice = await app.pool.query(`SELECT * FROM invoices WHERE id = $1`, [invoiceId]);
    if (invoice.rows.length === 0) {
      return true;
    }
    const row = invoice.rows[0];
    const amount = formatMoney(Number(row.amount_minor), currency);
    await app.alerts.push({
      title: 'Invoice overdue',
      message: `${engagement.reference} · invoice ${row.number} · ${amount}`,
    });
    return true;
  }
  return true;
}

async function quoteLinesText(app: App, engagement: EngagementRow): Promise<string> {
  const quote = await (await import('./domain')).buildQuote(app, engagement);
  const currency = engagement.brand_currency;
  const lines = quote.lines.map(line => `${line.title} × ${line.quantity}: ${formatMoney(line.amount_minor, currency)}`).join('\n');
  return `${lines}\nSubtotal: ${formatMoney(quote.subtotal_minor, currency)}\nVAT: ${formatMoney(quote.vat_minor, currency)}\nTotal: ${formatMoney(quote.total_minor, currency)}\n${quoteFxLineText(quote.fx_rate, currency, quote.fx_locked_at)}`;
}

function quoteFxLineText(rate: string, currency: CurrencyCode, lockedAt: string | null): string {
  if (currency === 'GBP') {
    return 'Priced in GBP.';
  }
  const rateText = Number(rate).toFixed(4);
  if (lockedAt) {
    return `Locked at ${rateText} per £1 on ${formatUtcDate(new Date(lockedAt))}.`;
  }
  return `Indicative at ${rateText} per £1.`;
}

async function quoteLinesHtml(app: App, engagement: EngagementRow): Promise<string> {
  const quote = await (await import('./domain')).buildQuote(app, engagement);
  const currency = engagement.brand_currency;
  const rows = quote.lines.map(line => `<tr><td>${escapeHtml(line.title)} × ${line.quantity}</td><td>${escapeHtml(formatMoney(line.amount_minor, currency))}</td></tr>`).join('');
  return `<table>${rows}<tr><td>Subtotal</td><td>${escapeHtml(formatMoney(quote.subtotal_minor, currency))}</td></tr><tr><td>VAT</td><td>${escapeHtml(formatMoney(quote.vat_minor, currency))}</td></tr><tr><td>Total</td><td>${escapeHtml(formatMoney(quote.total_minor, currency))}</td></tr></table>`;
}

async function invoiceLinesText(app: App, invoiceId: string): Promise<string> {
  const lines = await app.pool.query(`SELECT description, amount_minor FROM invoice_lines WHERE invoice_id = $1 ORDER BY created_at ASC`, [invoiceId]);
  const currency = await engagementCurrencyForInvoice(app, invoiceId);
  return lines.rows.map(line => `${line.description}: ${formatMoney(Number(line.amount_minor), currency)}`).join('\n');
}

async function engagementCurrencyForInvoice(app: App, invoiceId: string): Promise<CurrencyCode> {
  const result = await app.pool.query(
    `SELECT b.currency FROM invoices i JOIN engagements e ON e.id = i.engagement_id JOIN brands b ON b.id = e.brand_id WHERE i.id = $1`,
    [invoiceId],
  );
  return (result.rows[0]?.currency ?? 'GBP') as CurrencyCode;
}
