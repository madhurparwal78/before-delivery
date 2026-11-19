import { formatDateTime, monthLabel } from '../../shared/dates.ts';
import { formatMoney, splitMilestones } from '../../shared/money.ts';
import { config } from '../config.ts';
import { renderMessage, type RenderedMessage } from './mime.ts';

const OPERATOR_DISPLAY_NAME = 'Kettlehole Audio';

function milestoneLines(feeCents: number): string {
  return splitMilestones(feeCents)
    .map((milestone) => `  ${milestone.number}. ${milestone.name} (${milestone.percent}%): ${formatMoney(milestone.amount_cents)}`)
    .join('\n');
}

export function renderReceipt(input: {
  name: string;
  email: string;
  reference: string;
  brief: string;
  queuedAt: Date;
}): RenderedMessage {
  const body = [
    `Thank you — your brief reached Kettlehole Audio.`,
    ``,
    `Reference: ${input.reference}`,
    ``,
    `What you sent us:`,
    ``,
    input.brief,
    ``,
    `We listen to every brief and answer by email.`,
    ``,
    `Kettlehole Audio`,
  ].join('\n');
  return renderMessage({
    to: { name: input.name, address: input.email },
    subject: `Your brief reached Kettlehole Audio (${input.reference})`,
    body,
    queuedAt: input.queuedAt,
  });
}

export function renderAlert(input: {
  operatorEmail: string;
  name: string;
  email: string;
  studio: string;
  reference: string;
  brief: string;
  projectSlug: string;
  preferredMonth: string | null;
  queuedAt: Date;
}): RenderedMessage {
  const body = [
    `A new brief arrived.`,
    ``,
    `Reference: ${input.reference}`,
    `From: ${input.name} (${input.studio})`,
    `Email: ${input.email}`,
    `Station: ${input.projectSlug === '' ? 'no project' : input.projectSlug}`,
    `Preferred production month: ${input.preferredMonth === null ? 'no preference' : monthLabel(input.preferredMonth)}`,
    ``,
    input.brief,
  ].join('\n');
  return renderMessage({
    to: { name: OPERATOR_DISPLAY_NAME, address: input.operatorEmail },
    replyTo: { name: input.name, address: input.email },
    subject: `New brief ${input.reference} from ${input.studio}`,
    body,
    queuedAt: input.queuedAt,
  });
}

export function renderProposalEmail(input: {
  producerName: string;
  producerEmail: string;
  reference: string;
  projectTitle: string;
  feeCents: number;
  productionMonth: string;
  token: string;
  expiresAt: Date;
  timeZone: string;
  queuedAt: Date;
}): RenderedMessage {
  const body = [
    `Kettlehole Audio has sent you a proposal.`,
    ``,
    `Project: ${input.projectTitle}`,
    `Production month: ${monthLabel(input.productionMonth)}`,
    `Fee: ${formatMoney(input.feeCents)}`,
    ``,
    `Milestones:`,
    milestoneLines(input.feeCents),
    ``,
    `Accept the proposal here:`,
    `${config.publicUrl}/p/${input.token}`,
    ``,
    `This link stops working on ${formatDateTime(input.expiresAt, input.timeZone)}.`,
  ].join('\n');
  return renderMessage({
    to: { name: input.producerName, address: input.producerEmail },
    subject: `Proposal ${input.reference} from Kettlehole Audio: ${input.projectTitle}`,
    body,
    queuedAt: input.queuedAt,
  });
}

export function renderMonthHeldEmail(input: {
  producerName: string;
  producerEmail: string;
  projectTitle: string;
  feeCents: number;
  productionMonth: string;
  token: string;
  expiresAt: Date;
  depositCents: number;
  invoiceNumber: string;
  timeZone: string;
  queuedAt: Date;
}): RenderedMessage {
  const body = [
    `${monthLabel(input.productionMonth)} is held for ${input.projectTitle}.`,
    ``,
    `Deposit invoice ${input.invoiceNumber}: ${formatMoney(input.depositCents)}`,
    ``,
    `Milestones:`,
    milestoneLines(input.feeCents),
    ``,
    `Pay the deposit here:`,
    `${config.publicUrl}/p/${input.token}`,
    ``,
    `This link stops working on ${formatDateTime(input.expiresAt, input.timeZone)}.`,
  ].join('\n');
  return renderMessage({
    to: { name: input.producerName, address: input.producerEmail },
    subject: `${monthLabel(input.productionMonth)} held for ${input.projectTitle}: deposit due`,
    body,
    queuedAt: input.queuedAt,
  });
}

export function renderDepositReceivedEmail(input: {
  producerName: string;
  producerEmail: string;
  projectTitle: string;
  productionMonth: string;
  depositCents: number;
  invoiceNumber: string;
  paidAt: Date;
  timeZone: string;
  queuedAt: Date;
}): RenderedMessage {
  const body = [
    `Your deposit has been received.`,
    ``,
    `Project: ${input.projectTitle}`,
    `Production month: ${monthLabel(input.productionMonth)}`,
    `Deposit: ${formatMoney(input.depositCents)}`,
    `Invoice: ${input.invoiceNumber}`,
    `Recorded: ${formatDateTime(input.paidAt, input.timeZone)}`,
    ``,
    `${monthLabel(input.productionMonth)} is confirmed.`,
    ``,
    `Kettlehole Audio`,
  ].join('\n');
  return renderMessage({
    to: { name: input.producerName, address: input.producerEmail },
    subject: `Deposit received: ${monthLabel(input.productionMonth)} confirmed for ${input.projectTitle}`,
    body,
    queuedAt: input.queuedAt,
  });
}
