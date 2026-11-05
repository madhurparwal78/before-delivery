import { tierName, type Tier } from '../../shared/benches.js';
import { EVENT } from '../../shared/event.js';
import { formatDollars } from '../../shared/money.js';
import { renderPdf, type PdfLine } from '../services/pdf.js';

export type DocumentKind =
  | 'deposit-receipt'
  | 'balance-receipt'
  | 'full-receipt'
  | 'upgrade-receipt'
  | 'visa-letter'
  | 'certificate';

const RECEIPT_LABELS: Record<string, string> = {
  deposit: 'Deposit receipt',
  balance: 'Balance receipt',
  full: 'Full payment receipt',
  upgrade: 'Atelier upgrade receipt',
};

function header(title: string): PdfLine[] {
  return [
    { text: EVENT.site, size: 20, bold: true },
    { text: EVENT.courseTitle, size: 13 },
    { text: `${EVENT.dates} — ${EVENT.venueName}, ${EVENT.city}`, size: 10, gap: 8 },
    { text: title, size: 15, bold: true, gap: 10 },
  ];
}

export interface ReceiptInput {
  readonly kind: 'deposit' | 'balance' | 'full' | 'upgrade';
  readonly bench: string;
  readonly tier: Tier;
  readonly attendeeName: string | null;
  readonly billingName: string;
  readonly amountCents: number;
  readonly paidCents: number;
  readonly priceCents: number;
}

export function renderReceipt(input: ReceiptInput): Uint8Array {
  const lines: PdfLine[] = [
    ...header(RECEIPT_LABELS[input.kind] as string),
    { text: `Billed to: ${input.billingName}` },
    { text: `Bench ${input.bench}` },
    { text: `Tier: ${tierName(input.tier)}` },
    { text: `Attendee: ${input.attendeeName ?? 'Unassigned'}`, gap: 8 },
    { text: `Amount charged: $${formatDollars(input.amountCents)}`, bold: true },
    { text: `Paid to date: $${formatDollars(input.paidCents)}` },
    { text: `Seat price: $${formatDollars(input.priceCents)}` },
    { text: `Balance: $${formatDollars(input.priceCents - input.paidCents)}` },
  ];
  return renderPdf(lines);
}

export interface GroupInvoiceSeat {
  readonly bench: string;
  readonly tier: Tier;
  readonly attendeeName: string | null;
  readonly amountCents: number;
}

export function renderGroupInvoice(input: {
  readonly billingName: string;
  readonly seats: readonly GroupInvoiceSeat[];
  readonly totalCents: number;
}): Uint8Array {
  const lines: PdfLine[] = [
    ...header('Group invoice'),
    { text: `Billed to: ${input.billingName}`, gap: 8 },
    ...input.seats.map((seat) => ({
      text: `Bench ${seat.bench} — ${tierName(seat.tier)} — ${seat.attendeeName ?? 'Unassigned'} — $${formatDollars(seat.amountCents)}`,
    })),
    { text: `Invoice total: $${formatDollars(input.totalCents)}`, bold: true, gap: 8 },
  ];
  return renderPdf(lines);
}

export function renderVisaLetter(input: {
  readonly fullName: string;
  readonly nationality: string;
  readonly bench: string;
  readonly tier: Tier;
}): Uint8Array {
  const lines: PdfLine[] = [
    ...header('Visa-support letter'),
    { text: `To whom it may concern,`, gap: 6 },
    {
      text: `This letter confirms that ${input.fullName}, a national of ${input.nationality}, holds a`,
    },
    {
      text: `confirmed ${tierName(input.tier)} place at Bench ${input.bench} for ${EVENT.courseTitle},`,
    },
    { text: `a hands-on continuing education course held on ${EVENT.dates}` },
    { text: `at ${EVENT.venueName}, ${EVENT.venueAddress}.`, gap: 6 },
    { text: `The course is directed by ${EVENT.instructor} and awards ${EVENT.credits} credits.` },
    { text: `Attendance is required on both course days.`, gap: 10 },
    { text: EVENT.provider, bold: true },
    { text: `Provider ID ${EVENT.providerId}` },
  ];
  return renderPdf(lines);
}

export function renderCertificate(input: {
  readonly attendeeName: string;
  readonly licenceNumber: string;
  readonly licenceState: string;
  readonly certificateNumber: string;
}): Uint8Array {
  const lines: PdfLine[] = [
    ...header('Certificate of continuing education'),
    { text: input.attendeeName, size: 18, bold: true, gap: 6 },
    { text: `Licence number ${input.licenceNumber}` },
    { text: `Issuing state ${input.licenceState}`, gap: 8 },
    { text: EVENT.courseTitle, size: 13, bold: true },
    { text: `Provider: ${EVENT.provider}` },
    { text: `Provider ID: ${EVENT.providerId}` },
    { text: `Dates: ${EVENT.day1Label} and ${EVENT.day2Label}` },
    { text: `Location: ${EVENT.city}` },
    { text: `Educational format: ${EVENT.educationalFormat}` },
    { text: `${EVENT.credits} credits`, bold: true },
    { text: `Subject code: ${EVENT.subjectCode}` },
    { text: `Certificate number: ${input.certificateNumber}`, gap: 8 },
    { text: `Course director: ${EVENT.instructor}` },
  ];
  return renderPdf(lines);
}

export function receiptKey(reservationId: string, kind: ReceiptInput['kind']): string {
  return `receipts/${reservationId}/${kind}.pdf`;
}

export function groupInvoiceKey(groupId: string): string {
  return `receipts/groups/${groupId}/invoice.pdf`;
}

export function visaLetterKey(reservationId: string): string {
  return `visa-letters/${reservationId}.pdf`;
}

export function certificateKey(reservationId: string): string {
  return `certificates/${reservationId}.pdf`;
}

export function receiptDocumentKind(kind: ReceiptInput['kind']): DocumentKind {
  return `${kind}-receipt` as DocumentKind;
}
