import { randomUUID } from 'node:crypto';
import { query, type Queryable } from '../db/pool.js';
import { enqueue } from '../jobs/queue.js';
import { objectKeys } from '../services/s3.js';
import { formatAmount, formatSharePercent } from '../../shared/money.js';
import { INSTALLATION_LABELS, SIZE_LABELS, STUDIO_NAME } from '../../shared/seed.js';
import { formatDue, formatVenueDate, isoUtc } from '../../shared/venue-time.js';
import type { CommissionRow, FunderRow, MilestoneRow, QuoteRow } from './commissions.js';
import { venueOf } from './commissions.js';

/** Contract and invoice documents. An issued PDF's bytes are never rewritten. */

export type DocumentKind = 'contract' | 'invoice';

export interface DocumentRow {
  id: string;
  commission_id: string;
  kind: DocumentKind;
  version: number;
  label: string;
  status: 'preparing' | 'issued';
  object_key: string;
  size_bytes: number | null;
  sha256: string | null;
  issued_at: Date | null;
  payer_funder_id: string | null;
  payer_milestone_id: string | null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const STYLE = `
  body { font-family: Helvetica, Arial, sans-serif; color: #0b1020; font-size: 11pt; }
  h1 { font-size: 18pt; margin: 0 0 4pt; }
  h2 { font-size: 13pt; margin: 18pt 0 6pt; }
  table { width: 100%; border-collapse: collapse; margin: 6pt 0 12pt; }
  th, td { text-align: left; padding: 4pt 6pt; border-bottom: 1px solid #c9ced9; }
  td.amount, th.amount { text-align: right; font-variant-numeric: tabular-nums; }
  .total td { font-weight: bold; border-top: 2px solid #0b1020; }
  .meta { color: #43495a; }
`;

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(
    title,
  )}</title><style>${STYLE}</style></head><body>${body}</body></html>`;
}

export interface ContractInputs {
  commission: CommissionRow;
  clientName: string;
  quote: QuoteRow;
  funders: readonly FunderRow[];
  milestones: readonly MilestoneRow[];
  heldDate: string | null;
}

/** The contract rendered at signing. */
export function contractHtml(inputs: ContractInputs): string {
  const { commission, quote, funders, milestones } = inputs;
  const venue = venueOf(commission);
  const heading = `Commission agreement — ${commission.title}`;
  const lines = quote.lines
    .map(
      (line) =>
        `<tr><td>${escapeHtml(line.label)}</td><td class="amount">${formatAmount(
          line.amountCents,
        )}</td></tr>`,
    )
    .join('');
  const schedule = milestones
    .map(
      (m) =>
        `<tr><td>${escapeHtml(m.label)}</td><td class="amount">${formatSharePercent(
          m.schedule_bp,
        )}%</td><td class="amount">${formatAmount(m.amount_cents)}</td></tr>`,
    )
    .join('');
  const funderRows = funders
    .map(
      (f) =>
        `<tr><td>${escapeHtml(f.name)}</td><td>${escapeHtml(
          f.kind === 'client' ? 'Lead client' : 'Sponsor',
        )}</td><td class="amount">${formatSharePercent(f.bp)}%</td><td class="amount">${formatAmount(
          f.amount_cents,
        )}</td></tr>`,
    )
    .join('');

  return page(
    heading,
    `<h1>${escapeHtml(heading)}</h1>
     <p class="meta">${escapeHtml(STUDIO_NAME)} and ${escapeHtml(inputs.clientName)}</p>
     <h2>The installation</h2>
     <table>
       <tr><th>Installation</th><td>${escapeHtml(INSTALLATION_LABELS[commission.installation_type])}</td></tr>
       <tr><th>Size</th><td>${escapeHtml(SIZE_LABELS[commission.size_option])}</td></tr>
       <tr><th>Venue</th><td>${escapeHtml(`${venue.name}, ${venue.address}, ${venue.city}`)}</td></tr>
       <tr><th>Room</th><td>${Number(commission.width_m)} m × ${Number(commission.depth_m)} m, door on the ${escapeHtml(commission.door_wall)} wall</td></tr>
       <tr><th>Install day</th><td>${escapeHtml(inputs.heldDate ? formatVenueDate(inputs.heldDate) : 'To be booked')}</td></tr>
     </table>
     <h2>Quote</h2>
     <table>${lines}<tr class="total"><td>Total</td><td class="amount">${formatAmount(
       quote.total_cents,
     )}</td></tr></table>
     <h2>Payment schedule</h2>
     <table><tr><th>Milestone</th><th class="amount">Share</th><th class="amount">Amount</th></tr>${schedule}</table>
     <h2>Funders</h2>
     <table><tr><th>Funder</th><th>Role</th><th class="amount">Share</th><th class="amount">Amount</th></tr>${funderRows}</table>
     <h2>Signature</h2>
     <p>Signed by ${escapeHtml(commission.signature_name ?? '')} at ${escapeHtml(
       commission.signed_at ? isoUtc(commission.signed_at) : '',
     )}</p>`,
  );
}

export interface InvoiceInputs {
  commissionTitle: string;
  label: string;
  payerName: string;
  invoiceNumber: string;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  dueDate: string;
  timeZone: string;
}

/** The invoice rendered when its Kill Bill invoice is issued. */
export function invoiceHtml(inputs: InvoiceInputs): string {
  const heading = `Invoice — ${inputs.commissionTitle} — ${inputs.label}`;
  return page(
    heading,
    `<h1>${escapeHtml(heading)}</h1>
     <p class="meta">${escapeHtml(STUDIO_NAME)}</p>
     <table>
       <tr><th>Payer</th><td>${escapeHtml(inputs.payerName)}</td></tr>
       <tr><th>Kill Bill invoice</th><td>${escapeHtml(inputs.invoiceNumber)}</td></tr>
     </table>
     <table>
       <tr><td>Work</td><td class="amount">${formatAmount(inputs.subtotalCents)}</td></tr>
       <tr><td>Sales tax</td><td class="amount">${formatAmount(inputs.taxCents)}</td></tr>
       <tr class="total"><td>Total</td><td class="amount">${formatAmount(inputs.totalCents)}</td></tr>
     </table>
     <p>Due by: ${escapeHtml(formatDue(inputs.dueDate, inputs.timeZone))}</p>`,
  );
}

/**
 * Record a document as preparing and queue the job that renders and stores it.
 * The object key is fixed, so the bytes are written once.
 */
export async function createDocument(
  tx: Queryable,
  options: {
    commissionId: string;
    kind: DocumentKind;
    version: number;
    label: string;
    objectKey: string;
    html: string;
    payerFunderId?: string | null;
    payerMilestoneId?: string | null;
  },
): Promise<string> {
  const id = randomUUID();
  const inserted = await tx.query<{ id: string }>(
    `INSERT INTO documents (id, commission_id, kind, version, label, status, object_key, payer_funder_id, payer_milestone_id)
     VALUES ($1, $2, $3, $4, $5, 'preparing', $6, $7, $8)
     ON CONFLICT (object_key) DO NOTHING
     RETURNING id`,
    [
      id,
      options.commissionId,
      options.kind,
      options.version,
      options.label,
      options.objectKey,
      options.payerFunderId ?? null,
      options.payerMilestoneId ?? null,
    ],
  );
  const documentId = inserted.rows[0]?.id;
  if (!documentId) {
    const existing = await tx.query<{ id: string }>(
      'SELECT id FROM documents WHERE object_key = $1',
      [options.objectKey],
    );
    return existing.rows[0]?.id ?? id;
  }
  await enqueue(tx, {
    kind: 'pdf',
    commissionId: options.commissionId,
    dedupeKey: `pdf:${options.objectKey}`,
    payload: { documentId, html: options.html, objectKey: options.objectKey },
  });
  return documentId;
}

export async function listDocuments(commissionId: string): Promise<DocumentRow[]> {
  const result = await query<DocumentRow>(
    'SELECT * FROM documents WHERE commission_id = $1 ORDER BY created_at',
    [commissionId],
  );
  return result.rows;
}

export const documentKeys = objectKeys;
