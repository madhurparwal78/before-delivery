import { config } from '../config';
import { dateLabel, momentLabel } from '../../shared/zurich';
import type { Tx } from '../db';
import type { OutgoingMail } from '../providers/smtp';

function link(path: string): string {
  return `${config.publicUrl}${path}`;
}

export function estimateMail(input: {
  to: string;
  ownerName: string;
  jobNumber: string;
  jobId: string;
  carName: string;
  title: string;
  total: string;
  expiresDate: string;
}): OutgoingMail {
  return {
    to: input.to,
    subject: `Estimate ${input.jobNumber} for your ${input.carName} is ready`,
    body: [
      `Dear ${input.ownerName},`,
      '',
      `Estimate ${input.jobNumber} for your ${input.carName} is ready to approve.`,
      `Work: ${input.title}`,
      `Total: CHF ${input.total}`,
      `Please approve by ${dateLabel(input.expiresDate)}.`,
      '',
      link(`/portal/jobs/${input.jobId}`),
      '',
      'Marrow & Lark Motor House',
    ].join('\n'),
  };
}

export function releaseBookedMail(input: {
  to: string;
  ownerName: string;
  carName: string;
  slotLabel: string;
  bayCode: string;
  releaseId: string;
}): OutgoingMail {
  return {
    to: input.to,
    subject: `Release booked: ${input.carName}, ${input.slotLabel}`,
    body: [
      `Dear ${input.ownerName},`,
      '',
      `The release of your ${input.carName} is booked for ${input.slotLabel}.`,
      `Bay: ${input.bayCode}`,
      '',
      link(`/portal/releases/${input.releaseId}`),
      '',
      'Marrow & Lark Motor House',
    ].join('\n'),
  };
}

export function invoiceMail(input: {
  to: string;
  ownerName: string;
  carName: string;
  invoiceNumber: string;
  invoiceId: string;
  total: string;
}): OutgoingMail {
  return {
    to: input.to,
    subject: `Invoice ${input.invoiceNumber} for your ${input.carName}`,
    body: [
      `Dear ${input.ownerName},`,
      '',
      `Invoice ${input.invoiceNumber} for your ${input.carName} has been issued.`,
      `Total: CHF ${input.total}`,
      '',
      link(`/portal/invoices/${input.invoiceId}`),
      '',
      'Marrow & Lark Motor House',
    ].join('\n'),
  };
}

export function releasedMail(input: {
  to: string;
  ownerName: string;
  carName: string;
  at: Date;
  bayCode: string;
}): OutgoingMail {
  return {
    to: input.to,
    subject: `Your ${input.carName} has been released`,
    body: [
      `Dear ${input.ownerName},`,
      '',
      `Your ${input.carName} was released on ${momentLabel(input.at)}.`,
      `Bay: ${input.bayCode}`,
      '',
      'Marrow & Lark Motor House',
    ].join('\n'),
  };
}

/** Queues one message in Postgres, inside the action's own transaction. */
export async function queueMail(tx: Tx, mail: OutgoingMail): Promise<void> {
  await tx.query(
    "insert into queue (kind, payload, created_at) values ('email', $1, now())",
    [JSON.stringify(mail)],
  );
}
