import PDFDocument from 'pdfkit';
import { q, one } from '../db.js';
import { clockNow } from '../clock.js';
import { t } from '../errors.js';
import { handler, currentUser, requireRole } from '../core.js';
import { putObject, getObject } from '../s3.js';
import { formatPence } from '../domain/money.js';
import { clinicDateOf, clinicTimeOf, clinicDayMonth, clinicYear } from '../tz.js';
import { KIND_LABELS } from './files.js';

const FONTS = {
  regular: 'fonts/DMSans-Regular.ttf',
  bold: 'fonts/DMSans-Bold.ttf',
};

export function clinicYear(date: Date): string {
  return String(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric' }).format(date));
}

export function historyLine(entry: any): string {
  const d = new Date(entry.start);
  const day = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: '2-digit', month: 'short' }).format(d);
  const year = clinicYear(d);
  return `${day} ${year} ${entry.reason} with ${entry.vetName}`;
}

export function invoiceLineText(line: any): string {
  return `${line.description} x${line.quantity} ${formatPence(line.totalPence)}`;
}


// One page per 25 body lines; the last-page extras do not count.
export function paginate<T>(items: T[], perPage = 25): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += perPage) pages.push(items.slice(i, i + perPage));
  if (pages.length === 0) pages.push([]);
  return pages;
}

export async function renderHistoryPdf(clinicId: string, patientId: string, includeFiles: boolean): Promise<Buffer> {
  const patient = await one(
    `select p.*, c.name as client_name from patients p join clients c on c.id = p.client_id
     where p.id = $1 and p.clinic_id = $2`,
    [patientId, clinicId]
  );
  if (!patient) throw t('not_found');
  const history = await q(
    `select a.id, a.start_at, a.reason, u.name as vet_name from appointments a
     join users u on u.id = a.vet_id
     where a.patient_id = $1 and a.clinic_id = $2 and a.status = 'completed'
     order by a.start_at desc`,
    [patientId, clinicId]
  );
  const files = includeFiles
    ? await q(`select * from patient_files where patient_id = $1 order by created_at`, [patientId])
    : { rows: [] };
  const bodyLines = [
    ...history.rows.map((h: any) => historyLine({ start: h.start_at, reason: h.reason, vetName: h.vet_name })),
    ...files.rows.map((f: any) => `File: ${f.name} (${KIND_LABELS[f.kind] ?? f.kind})`),
  ];
  return renderPdf(`Patient: ${patient.name}`, bodyLines, []);
}

export async function renderInvoicePdf(clinicId: string, invoiceId: string): Promise<Buffer> {
  const { invoicePayload } = await import('./invoices.js');
  const inv = await invoicePayload(invoiceId, clinicId);
  if (!inv) throw t('not_found');
  const bodyLines = inv.lines.map((l: any) => invoiceLineText(l));
  const lastPage: string[] = [
    `Total ${formatPence(inv.totalPence)}`,
    `Paid ${formatPence(inv.paidPence)}`,
    `Balance due ${formatPence(inv.balancePence)}`,
    ...inv.payments.map((p: any) => {
      const at = new Date(p.at);
      const date = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: '2-digit', month: 'short' }).format(at);
      const year = clinicYear(at);
      return `Payment ${formatPence(p.pence)} taken by ${p.takenBy?.name ?? 'Unknown'} at ${clinicTimeOf(at)} on ${date} ${year}`;
    }),
  ];
  if (inv.voidedBy) {
    const at = new Date(inv.voidedAt!);
    lastPage.push(`Voided by ${inv.voidedBy.name} at ${clinicTimeOf(at)}: ${inv.voidReason}`);
  }
  return renderPdf(`Invoice ${inv.number}`, bodyLines, lastPage);
}

function docHeader(title: string): { doc: any; buffers: Buffer[] } {
  const doc = new PDFDocument({ size: 'A4', margin: 40 } as any);
  const buffers: Buffer[] = [];
  doc.on('data', (b: Buffer) => buffers.push(b));
  return { doc, buffers };
}

async function renderPdf(title: string, bodyLines: string[], lastPageLines: string[]): Promise<Buffer> {
  const { doc, buffers } = docHeader(title);
  const pages = paginate(bodyLines);
  const done = new Promise<Buffer>((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(buffers)));
  });
  pages.forEach((pageLines, pageIndex) => {
    if (pageIndex > 0) doc.addPage();
    doc.registerFont('body', 'fonts/DMSans-Regular.ttf');
    doc.registerFont('head', 'fonts/DMSans-Bold.ttf');
    doc.font('head').fontSize(14).text(title, 40, 40);
    let y = 90;
    doc.font('body').fontSize(11);
    for (const line of pageLines) {
      doc.text(line, 40, y);
      y += 18;
    }
    if (pageIndex === pages.length - 1) {
      y += 10;
      for (const extra of lastPageLines) {
        doc.text(extra, 40, y);
        y += 18;
      }
    }
    doc.font('body').fontSize(9);
    doc.text(`Page ${pageIndex + 1} of ${pages.length}`, 40, 780);
  });
  doc.end();
  return done;
}
