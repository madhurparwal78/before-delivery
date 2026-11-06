import { zurichDate, zurichSlotLabel, zurichMomentLabel } from '../shared/dates.ts';
import type { Env } from './env.ts';

/**
 * Owner emails — each goes only to the car's owner, exactly once per event,
 * with the published subject. Links go through APP_PUBLIC_URL.
 */
export interface EstimateEmailData {
  jobNumber: string;
  carName: string;
  title: string;
  total: string;
  expiresAt: string;
  jobId: string;
}

export interface BookedEmailData {
  carName: string;
  slotLabel: string;
  bayCode: string;
  releaseId: string;
}

export interface InvoiceEmailData {
  invoiceNumber: string;
  carName: string;
  total: string;
  invoiceId: string;
}

export interface ReleasedEmailData {
  carName: string;
  releasedAt: string;
  bayCode: string;
}

export function portalLink(env: Env, path: string): string {
  return `${env.appPublicUrl}${path}`;
}

export function estimateEmail(env: Env, data: EstimateEmailData): { subject: string; text: string } {
  const subject = `Estimate ${data.jobNumber} for your ${data.carName} is ready`;
  const link = portalLink(env, `/portal/jobs/${data.jobId}`);
  const text = [
    `Dear owner,`,
    ``,
    `Estimate ${data.jobNumber} for your ${data.carName} is ready: ${data.title}.`,
    `Total: CHF ${data.total}`,
    `Please approve by ${zurichDate(data.expiresAt)}.`,
    ``,
    `Open the estimate: ${link}`,
    ``,
    `Marrow & Lark Motor House`,
  ].join('\n');
  return { subject, text };
}

export function bookedEmail(env: Env, data: BookedEmailData): { subject: string; text: string } {
  const subject = `Release booked: ${data.carName}, ${data.slotLabel}`;
  const link = portalLink(env, `/portal/releases/${data.releaseId}`);
  const text = [
    `Dear owner,`,
    ``,
    `Your release is booked for ${data.slotLabel}. The car is in bay ${data.bayCode}.`,
    ``,
    `Open your release: ${link}`,
    ``,
    `Marrow & Lark Motor House`,
  ].join('\n');
  return { subject, text };
}

export function invoiceEmail(env: Env, data: InvoiceEmailData): { subject: string; text: string } {
  const subject = `Invoice ${data.invoiceNumber} for your ${data.carName}`;
  const link = portalLink(env, `/portal/invoices/${data.invoiceId}`);
  const text = [
    `Dear owner,`,
    ``,
    `Invoice ${data.invoiceNumber} for your ${data.carName} has been issued.`,
    `Total: CHF ${data.total}`,
    ``,
    `Open the invoice: ${link}`,
    ``,
    `Marrow & Lark Motor House`,
  ].join('\n');
  return { subject, text };
}

export function releasedEmail(env: Env, data: ReleasedEmailData): { subject: string; text: string } {
  const subject = `Your ${data.carName} has been released`;
  const text = [
    `Dear owner,`,
    ``,
    `Your ${data.carName} was released on ${zurichMomentLabel(data.releasedAt)}.`,
    `The car has left bay ${data.bayCode}.`,
    ``,
    `Marrow & Lark Motor House`,
  ].join('\n');
  return { subject, text };
}

export { zurichDate, zurichSlotLabel };
