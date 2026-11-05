import PDFDocument from "pdfkit";
import { COURSE } from "./config.js";
import { formatCents, tierName } from "./format.js";

export type ReceiptKind = "deposit" | "balance" | "full" | "upgrade";

type Doc = PDFKit.PDFDocument;

function baseDoc(): Doc {
  return new PDFDocument({ size: "A4", margins: { top: 60, bottom: 60, left: 64, right: 64 } });
}

function titleBlock(doc: Doc, heading: string, sub: string): void {
  doc.font("Helvetica-Bold").fontSize(20).fillColor("#1c1512").text(heading);
  doc.font("Helvetica").fontSize(10).fillColor("#555").text(sub, { paragraphGap: 10 });
  doc.moveDown(0.5);
}

const LINE = (doc: Doc) => {
  doc.moveTo(64, doc.y).lineTo(doc.page.width - 64, doc.y).lineWidth(0.75).strokeColor("#c9c0b4").stroke();
  doc.moveDown(1);
};

export interface ReceiptLine {
  bench: string;
  tier: string;
  amountCents: number;
  attendeeName: string | null;
  note: string;
}

/** Receipts and group invoice PDFs list only benches, tiers, amounts and attendee names. */
export async function renderReceiptPdf(opts: { heading: string; sub: string; lines: ReceiptLine[]; totalCents: number; billingName: string }): Promise<Buffer> {
  const doc = baseDoc();
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  titleBlock(doc, opts.heading, opts.sub);
  doc.font("Helvetica").fontSize(10).fillColor("#1c1512").text(`Billed to: ${opts.billingName}`);
  LINE(doc);
  for (const line of opts.lines) {
    doc.font("Helvetica-Bold").fontSize(11).text(`Bench ${line.bench} — ${tierName(line.tier)}${line.note ? ` (${line.note})` : ""}`);
    doc.font("Helvetica").fontSize(10).text(`Attendee: ${line.attendeeName ?? "Unassigned"}`);
    doc.font("Helvetica").fontSize(10).text(`Amount: $${formatCents(line.amountCents)}`);
    doc.moveDown(0.5);
  }
  LINE(doc);
  doc.font("Helvetica-Bold").fontSize(12).text(`Total: $${formatCents(opts.totalCents)}`);
  doc.moveDown(1);
  doc.font("Helvetica").fontSize(9).fillColor("#555").text(`${COURSE.title} — ${COURSE.dates}. ${COURSE.venue}.`);
  doc.end();
  return done;
}

export async function renderGroupInvoicePdf(opts: { groupSeats: { bench: string; tier: string; amountCents: number; attendeeName: string | null }[]; totalCents: number; billingName: string }): Promise<Buffer> {
  return renderReceiptPdf({
    heading: "Group invoice",
    sub: "Opaline Bench Days",
    lines: opts.groupSeats.map((s) => ({ ...s, note: "full price" })),
    totalCents: opts.totalCents,
    billingName: opts.billingName,
  });
}

export async function renderVisaLetterPdf(opts: { name: string; nationality: string; passportNumber: string; bench: string }): Promise<Buffer> {
  const doc = baseDoc();
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  titleBlock(doc, "Visa-support letter", "Opaline Bench Days");
  doc.font("Helvetica").fontSize(11).fillColor("#1c1512");
  doc.text(`To Whom It May Concern,`);
  doc.moveDown(0.5);
  doc.text(
    `This letter confirms that ${opts.name} (nationality: ${opts.nationality}, passport number ${opts.passportNumber}) is enrolled in ${COURSE.title}, a two-day hands-on continuing-education course held on ${COURSE.dates} at ${COURSE.venue}.`
  );
  doc.moveDown(0.5);
  doc.text(`The attendee holds Bench ${opts.bench} for the duration of the course.`);
  doc.moveDown(0.5);
  doc.text(`The course is organised by ${COURSE.provider} (provider ID ${COURSE.providerId}), directed by ${COURSE.instructor}, and awards ${COURSE.credits} credits (${COURSE.format}).`);
  doc.moveDown(1);
  doc.text(`Sincerely,`);
  doc.text(`${COURSE.instructor}, Course Director`);
  doc.end();
  return done;
}

export async function renderCertificatePdf(opts: {
  attendeeName: string;
  licenceNumber: string;
  licenceState: string;
  certificateNumber: string;
}): Promise<Buffer> {
  const doc = baseDoc();
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  titleBlock(doc, "Certificate of Completion", `${COURSE.provider} — Provider ID ${COURSE.providerId}`);
  doc.font("Helvetica-Bold").fontSize(16).fillColor("#1c1512").text(`This certifies that ${opts.attendeeName}`);
  doc.moveDown(0.5);
  doc.font("Helvetica").fontSize(11).fillColor("#1c1512");
  doc.text(`Licence number ${opts.licenceNumber} (${opts.licenceState})`);
  doc.moveDown(0.5);
  doc.text(`has completed ${COURSE.title}, held on ${COURSE.dates} in Chicago, Illinois.`);
  doc.moveDown(0.5);
  doc.text(`Educational format: ${COURSE.format}`);
  doc.text(`CE credits awarded: ${COURSE.credits} credits`);
  doc.text(`Subject code: ${COURSE.subjectCode}`);
  doc.moveDown(0.5);
  doc.text(`Certificate number: ${opts.certificateNumber}`);
  doc.moveDown(1);
  doc.text(`Course Director: ${COURSE.instructor}`);
  doc.font("Helvetica").fontSize(9).fillColor("#555").text(`${COURSE.provider} • ${COURSE.venue}`);
  doc.end();
  return done;
}
