// The wording of every outbound email. Dates are written in the operator's zone as it stands when queued.

import { config } from "./config.js";
import type { Letter, Mailbox } from "./mail.js";
import { formatBusinessDate, monthLabel } from "../shared/dates.js";
import { formatUsd } from "../shared/money.js";
import { MILESTONES } from "./milestones.js";

interface Director {
  id: string;
  reference: string;
  name: string;
  email: string;
  studio: string;
  brief: string;
  preferredMonth: string | null;
  projectSlug: string | null;
  attachment: { filename: string; bytes: number } | null;
}

export interface ProposalTerms {
  enquiryId: string;
  reference: string;
  token: string;
  producer: Mailbox;
  projectTitle: string;
  scope: string;
  feeCents: number;
  productionMonth: string;
  milestoneCents: number[];
  expiresAt: Date;
}

const acceptUrl = (token: string): string => `${config.publicUrl}/p/${token}`;

function milestoneLines(cents: number[]): string {
  return MILESTONES.map((m, i) => `${m.number}. ${m.name} (${m.percent}%): $${formatUsd(cents[i] ?? 0)}`).join("\n");
}

function expiryLine(terms: ProposalTerms, timeZone: string): string {
  return `The accept link works until ${formatBusinessDate(terms.expiresAt, timeZone)} (${timeZone} time).`;
}

export function receiptLetter(director: Director): Letter {
  return {
    kind: "receipt",
    enquiryId: director.id,
    to: { name: director.name, address: director.email },
    subject: `Your brief reached Kettlehole Audio (${director.reference})`,
    text: [
      `Hello ${director.name},`,
      "",
      `Thank you for your brief. It is filed as ${director.reference}, and Kettlehole Audio reads every brief personally.`,
      "",
      "This is what you sent:",
      "",
      director.brief,
      "",
      "— Kettlehole Audio",
    ].join("\n"),
  };
}

export function alertLetter(director: Director, operatorEmail: string): Letter {
  return {
    kind: "alert",
    enquiryId: director.id,
    to: { name: "Kettlehole Audio", address: operatorEmail },
    replyTo: { name: director.name, address: director.email },
    subject: `New brief ${director.reference} from ${director.studio}`,
    text: [
      `New brief ${director.reference}`,
      "",
      `From: ${director.name} <${director.email}>`,
      `Studio: ${director.studio}`,
      `Preferred production month: ${director.preferredMonth ? monthLabel(director.preferredMonth) : "No preference"}`,
      `Heard project: ${director.projectSlug ?? "none"}`,
      `Reference file: ${director.attachment ? `${director.attachment.filename} (${director.attachment.bytes} bytes)` : "none"}`,
      "",
      director.brief,
      "",
      "Reply to this email to answer the director directly.",
    ].join("\n"),
  };
}

export function proposalLetter(terms: ProposalTerms, timeZone: string): Letter {
  return {
    kind: "proposal",
    enquiryId: terms.enquiryId,
    to: terms.producer,
    subject: `Proposal ${terms.reference} from Kettlehole Audio: ${terms.projectTitle}`,
    text: [
      `Hello ${terms.producer.name},`,
      "",
      `Kettlehole Audio has prepared proposal ${terms.reference} for ${terms.projectTitle}.`,
      "",
      "Scope",
      terms.scope,
      "",
      `Fee: $${formatUsd(terms.feeCents)} USD`,
      `Production month: ${monthLabel(terms.productionMonth)}`,
      "",
      "Milestones",
      milestoneLines(terms.milestoneCents),
      "",
      "Review the proposal and accept it to hold the month:",
      acceptUrl(terms.token),
      "",
      expiryLine(terms, timeZone),
    ].join("\n"),
  };
}

export function heldLetter(terms: ProposalTerms, timeZone: string, invoiceNumber: string): Letter {
  const month = monthLabel(terms.productionMonth);
  return {
    kind: "month_held",
    enquiryId: terms.enquiryId,
    to: terms.producer,
    subject: `${month} held for ${terms.projectTitle}: deposit due`,
    text: [
      `Hello ${terms.producer.name},`,
      "",
      `${month} is held for ${terms.projectTitle} (proposal ${terms.reference}).`,
      `Deposit invoice ${invoiceNumber} is due: $${formatUsd(terms.milestoneCents[0] ?? 0)} USD.`,
      "",
      "Milestones",
      milestoneLines(terms.milestoneCents),
      "",
      "Pay the deposit on your proposal page to confirm the month:",
      acceptUrl(terms.token),
      "",
      expiryLine(terms, timeZone),
    ].join("\n"),
  };
}

export function depositLetter(terms: ProposalTerms, amountCents: number, invoiceNumber: string): Letter {
  const month = monthLabel(terms.productionMonth);
  return {
    kind: "deposit",
    enquiryId: terms.enquiryId,
    to: terms.producer,
    subject: `Deposit received: ${month} confirmed for ${terms.projectTitle}`,
    text: [
      `Hello ${terms.producer.name},`,
      "",
      `The deposit of $${formatUsd(amountCents)} USD for invoice ${invoiceNumber} has been received.`,
      `${month} is confirmed for ${terms.projectTitle} (proposal ${terms.reference}).`,
      "",
      "Kettlehole Audio will be in touch to start production.",
      "",
      acceptUrl(terms.token),
    ].join("\n"),
  };
}

