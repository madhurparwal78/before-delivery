// What generated PDFs say. Receipts and invoices carry benches, tiers, amounts and names only.
import { formatDollars } from "./money.js";
import { renderPdf, type PdfLine } from "./pdf.js";
import { TIER_NAME, tierOf } from "./rules.js";

const EVENT = {
  title: "Layered Composite Masterclass",
  dates: "Friday 16 and Saturday 17 April 2027",
  venue: "The Opaline Lab, 1460 West Kinzie Street, Chicago, Illinois",
  director: "Dr. Celeste Marrow-Ibarra",
  provider: "Opaline Institute",
  providerId: "OI-PACE-219874",
  format: "Lecture and participation (hands-on)",
  credits: "16 credits",
  subject: "250 Operative (restorative) dentistry",
};

const RECEIPT_TITLE: Record<string, string> = {
  deposit: "Deposit receipt",
  balance: "Balance receipt",
  full: "Paid-in-full receipt",
  upgrade: "Atelier upgrade receipt",
  group: "Group invoice",
};

const header = (title: string): PdfLine[] => [
  { text: "Opaline Bench Days", font: "title", size: 26, gap: 0 },
  { text: `${EVENT.title}  |  ${EVENT.dates}  |  Chicago, Illinois`, size: 10, gap: 22 },
  { text: title, font: "bold", size: 16, gap: 40 },
];

interface ReceiptSeat {
  bench: string;
  amountCents: number;
  attendee: string | null;
}

export function receiptPdf(kind: string, billingName: string, seats: readonly ReceiptSeat[], issued: Date): Buffer {
  const total = seats.reduce((sum, seat) => sum + seat.amountCents, 0);
  return renderPdf([
    ...header(RECEIPT_TITLE[kind] ?? "Receipt"),
    { text: `Billed to ${billingName}`, gap: 28 },
    { text: `Issued ${issued.toISOString().slice(0, 10)}` },
    ...seats.flatMap((seat): PdfLine[] => [
      { text: `Bench ${seat.bench}  -  ${TIER_NAME[tierOf(seat.bench)]} tier  -  $${formatDollars(seat.amountCents)}`, font: "bold", gap: 28 },
      { text: `Attendee: ${seat.attendee ?? "Unassigned"}` },
    ]),
    { text: `Total paid  $${formatDollars(total)}`, font: "bold", size: 14, gap: 36 },
    { text: "Recorded in Kill Bill against the external payment method. Questions: registrar@opaline-institute.test", size: 9, gap: 40 },
  ]);
}

export function visaLetterPdf(passport: { fullName: string; nationality: string; number: string }, bench: string, issued: Date): Buffer {
  return renderPdf([
    ...header("Visa-support letter"),
    { text: `Date: ${issued.toISOString().slice(0, 10)}`, gap: 28 },
    { text: "To the consular officer concerned,", gap: 28 },
    { text: `This letter confirms that ${passport.fullName}, a national of ${passport.nationality},` },
    { text: `holder of passport number ${passport.number}, holds a confirmed seat (Bench ${bench}) at the` },
    { text: `${EVENT.title}, a live continuing-education course held on ${EVENT.dates}` },
    { text: `at ${EVENT.venue}.` },
    { text: `The course is provided by ${EVENT.provider} (provider ID ${EVENT.providerId}).`, gap: 28 },
    { text: "The attendee is responsible for their own travel, lodging and living costs.", gap: 22 },
    { text: "Sincerely,", gap: 36 },
    { text: EVENT.director, font: "bold" },
    { text: `Course director, ${EVENT.provider}` },
  ]);
}

export function certificatePdf(cert: {
  attendee: string;
  licenceNumber: string;
  licenceState: string;
  number: string;
}): Buffer {
  return renderPdf([
    ...header("Certificate of continuing education"),
    { text: "This certifies that", gap: 30 },
    { text: cert.attendee, font: "title", size: 24, gap: 34 },
    { text: `Licence ${cert.licenceNumber}, issued by ${cert.licenceState}`, gap: 24 },
    { text: `attended ${EVENT.title}`, gap: 26 },
    { text: `Dates: 16 and 17 April 2027` },
    { text: "Location: Chicago, Illinois" },
    { text: `Educational format: ${EVENT.format}` },
    { text: `Credits: ${EVENT.credits}` },
    { text: `Subject code: ${EVENT.subject}` },
    { text: `Provider: ${EVENT.provider}, provider ID ${EVENT.providerId}`, gap: 24 },
    { text: `Certificate number: ${cert.number}`, font: "bold", gap: 26 },
    { text: `Course director: ${EVENT.director}`, gap: 36 },
  ]);
}
