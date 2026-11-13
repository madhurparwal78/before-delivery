import { config } from '../config.js';
import { MILESTONE_LABEL, type ReviewMilestone } from '../../shared/domain.js';
import { formatMoney } from '../../shared/money.js';
import { payByLine } from '../../shared/format.js';
import { contactOfRole } from '../db/brands.js';
import {
  findEngagement,
  findInvoice,
  listInvoiceLines,
  listLedger,
  listQuoteLines,
  type EngagementRow,
  type InvoiceRow,
} from '../db/engagements.js';
import { claimOutboxBatch, markOutboxSent, releaseOutbox, type OutboxRow } from '../db/outbox.js';
import { listRates } from '../db/fx.js';
import { renderPdf } from '../services/documents.js';
import { sendEmail, type Attachment } from '../services/mail.js';
import { sendPush } from '../services/push.js';
import { servicesForRead } from './content.js';
import { documentHtml, documentText, moneyDocumentFor, type MoneyDocument } from './documents.js';
import { quoteViewOf } from '../serialise.js';

const accountLink = (engagementId: string): string =>
  `${config.publicUrl ?? ''}/account/engagements/${engagementId}`;

type Prepared = { to: string; subject: string; text: string; attachments?: Attachment[] };

const invoiceDocument = async (
  invoice: InvoiceRow,
  engagement: EngagementRow,
  heading: string,
  amountLabel: string,
): Promise<MoneyDocument> => {
  const [services, rates, lines, quoteLines] = await Promise.all([
    servicesForRead(),
    listRates(),
    listInvoiceLines(invoice.id),
    listQuoteLines(engagement.id),
  ]);
  const quote = quoteViewOf(engagement, quoteLines, services, rates, new Date());
  return moneyDocumentFor({
    heading,
    amountLabel,
    amountMinor: BigInt(invoice.amount_minor),
    reference: engagement.reference,
    brandName: engagement.brand_name,
    quote,
    documentLines: lines.map((line) => ({
      description: line.description,
      amountMinor: BigInt(line.amount_minor),
    })),
  });
};

const financeEmail = async (engagement: EngagementRow): Promise<string> =>
  (await contactOfRole(engagement.brand_id, 'finance'))?.email ?? '';

const invoiceContext = async (
  payload: Record<string, unknown>,
): Promise<{ invoice: InvoiceRow; engagement: EngagementRow } | null> => {
  const invoiceId = typeof payload.invoice_id === 'string' ? payload.invoice_id : null;
  if (invoiceId === null) return null;
  const invoice = await findInvoice(invoiceId);
  if (invoice === null) return null;
  const engagement = await findEngagement(invoice.engagement_id);
  if (engagement === null) return null;
  return { invoice, engagement };
};

const prepare = async (row: OutboxRow): Promise<Prepared | null> => {
  switch (row.kind) {
    case 'signin_code_email': {
      const to = typeof row.payload.email === 'string' ? row.payload.email : '';
      const code = typeof row.payload.code === 'string' ? row.payload.code : '';
      return {
        to,
        subject: 'Your Gloamwork sign-in code',
        text: `Your Gloamwork sign-in code is ${code}.\n\nIt expires in ${config.signinCodeTtlSeconds} seconds.\n`,
      };
    }
    case 'deposit_receipt_email': {
      const context = await invoiceContext(row.payload);
      if (context === null) return null;
      const document = await invoiceDocument(
        context.invoice,
        context.engagement,
        'Deposit receipt',
        'Deposit paid',
      );
      const pdf = await renderPdf(documentHtml(document));
      return {
        to: await financeEmail(context.engagement),
        subject: `Deposit receipt: ${context.engagement.reference}`,
        text: `${documentText(document)}\n${accountLink(context.engagement.id)}\n`,
        attachments: [
          {
            filename: `${context.engagement.reference}-deposit.pdf`,
            contentType: 'application/pdf',
            bytes: pdf,
          },
        ],
      };
    }
    case 'invoice_issued_email': {
      const context = await invoiceContext(row.payload);
      if (context === null) return null;
      const number = context.invoice.number ?? '';
      const document = await invoiceDocument(
        context.invoice,
        context.engagement,
        `Invoice ${number}`,
        'Amount due',
      );
      const pdf = await renderPdf(documentHtml(document));
      return {
        to: await financeEmail(context.engagement),
        subject: `Invoice ${number} issued: ${context.engagement.reference}`,
        text: `${documentText(document)}\n${accountLink(context.engagement.id)}\n`,
        attachments: [
          {
            filename: `${context.engagement.reference}-${number}.pdf`,
            contentType: 'application/pdf',
            bytes: pdf,
          },
        ],
      };
    }
    case 'invoice_receipt_email': {
      const context = await invoiceContext(row.payload);
      if (context === null) return null;
      const number = context.invoice.number ?? '';
      const document = await invoiceDocument(
        context.invoice,
        context.engagement,
        `Receipt for invoice ${number}`,
        'Paid',
      );
      return {
        to: await financeEmail(context.engagement),
        subject: `Receipt for invoice ${number}: ${context.engagement.reference}`,
        text: `${documentText(document)}\n${accountLink(context.engagement.id)}\n`,
      };
    }
    case 'payment_failed_email': {
      const context = await invoiceContext(row.payload);
      if (context === null) return null;
      const number = context.invoice.number ?? '';
      const document = await invoiceDocument(
        context.invoice,
        context.engagement,
        `Payment failed for invoice ${number}`,
        'Amount due',
      );
      const payBy =
        context.invoice.overdue_at === null
          ? ''
          : `${payByLine(context.invoice.overdue_at.toISOString())}\n`;
      return {
        to: await financeEmail(context.engagement),
        subject: `Payment failed for invoice ${number}: ${context.engagement.reference}`,
        text: `${documentText(document)}${payBy}\n${accountLink(context.engagement.id)}\n`,
      };
    }
    case 'overdue_email': {
      const context = await invoiceContext(row.payload);
      if (context === null) return null;
      const number = context.invoice.number ?? '';
      const document = await invoiceDocument(
        context.invoice,
        context.engagement,
        `Invoice ${number} is overdue`,
        'Amount due',
      );
      return {
        to: await financeEmail(context.engagement),
        subject: `Invoice ${number} is overdue: ${context.engagement.reference}`,
        text: `${documentText(document)}\n${accountLink(context.engagement.id)}\n`,
      };
    }
    case 'review_link_email': {
      const engagementId =
        typeof row.payload.engagement_id === 'string' ? row.payload.engagement_id : '';
      const engagement = await findEngagement(engagementId);
      if (engagement === null) return null;
      const milestone = row.payload.milestone as ReviewMilestone;
      const reviewer = await contactOfRole(engagement.brand_id, 'reviewer');
      return {
        to: reviewer?.email ?? '',
        subject: `${milestone === 'look_dev' ? 'Look-dev' : 'Final'} stills ready for review: ${engagement.reference}`,
        text: [
          engagement.reference,
          engagement.brand_name,
          MILESTONE_LABEL[milestone],
          String(row.payload.review_url ?? ''),
          String(row.payload.expiry_line ?? ''),
          '',
        ].join('\n'),
      };
    }
    case 'refund_email': {
      const engagementId =
        typeof row.payload.engagement_id === 'string' ? row.payload.engagement_id : '';
      const engagement = await findEngagement(engagementId);
      if (engagement === null) return null;
      const refunds = (await listLedger(engagement.id)).filter((entry) => entry.kind === 'refund');
      const total = refunds.reduce((sum, entry) => sum + BigInt(entry.amount_minor), 0n);
      const amount = formatMoney(total, engagement.brand_currency);
      return {
        to: await financeEmail(engagement),
        subject: `Refund of ${amount}: ${engagement.reference}`,
        text: [
          `Refund of ${amount}`,
          `Reference: ${engagement.reference}`,
          `Brand: ${engagement.brand_name}`,
          '',
          ...refunds.map(
            (entry) =>
              `Refund on payment ${entry.killbill_payment_id}: ${formatMoney(BigInt(entry.amount_minor), engagement.brand_currency)}`,
          ),
          '',
          accountLink(engagement.id),
          '',
        ].join('\n'),
      };
    }
    case 'push':
      return null;
  }
};

const deliver = async (row: OutboxRow): Promise<void> => {
  if (row.kind === 'push') {
    await sendPush({
      title: String(row.payload.title ?? ''),
      message: String(row.payload.message ?? ''),
    });
    return;
  }
  const email = await prepare(row);
  if (email === null || email.to === '') return;
  await sendEmail(email);
};

let draining = false;

export const drainOutbox = async (): Promise<void> => {
  if (draining) return;
  draining = true;
  try {
    const batch = await claimOutboxBatch();
    for (const row of batch) {
      try {
        await deliver(row);
        await markOutboxSent(row.id);
      } catch {
        await releaseOutbox(row.id);
      }
    }
  } finally {
    draining = false;
  }
};

export const startOutboxWorker = (): void => {
  setInterval(() => {
    void drainOutbox().catch(() => undefined);
  }, 1_000).unref();
};

export const kickOutbox = (): void => {
  void drainOutbox().catch(() => undefined);
};
