import { config } from './config';
import { sendMail } from './mail';

export async function sendConfirmationEmail(to: string, name: string, token: string): Promise<void> {
  const link = `${config.publicUrl}/verify/${token}`;
  const body = [
    `Hello ${name},`,
    '',
    'Confirm your email address to start drafting in Corbel Draft:',
    link,
    '',
    'Corbel Works',
  ].join('\n');
  await sendMail(to, 'Confirm your Corbel Draft account', body);
}

export async function sendInviteEmail(options: {
  to: string;
  drafterName: string;
  drawingName: string;
  url: string;
  accessLabel: string;
  expiryLine: string;
}): Promise<void> {
  const body = [
    `${options.drafterName} shared a drawing with you.`,
    '',
    options.url,
    options.accessLabel,
    options.expiryLine,
    '',
    'Corbel Works',
  ].join('\n');
  await sendMail(options.to, `${options.drafterName} shared "${options.drawingName}" with you`, body);
}

export async function sendQuoteEmail(options: {
  to: string;
  quoteNumber: string;
  issueDate: string;
}): Promise<void> {
  const body = [
    'Thank you for your interest in Corbel Draft Pro.',
    '',
    '$12.00 per month',
    `Quote ${options.quoteNumber}`,
    options.issueDate,
    '',
    'There is nothing to pay here; reply to this quote to continue.',
    '',
    'Corbel Works',
  ].join('\n');
  await sendMail(options.to, 'Your Corbel Draft Pro quote', body);
}

export async function sendTraceSubmittedEmail(options: {
  to: string;
  traceName: string;
  drawingName: string;
  reviewerName: string;
  issueCount: number;
}): Promise<void> {
  const body = [
    `${options.reviewerName} submitted a trace on ${options.drawingName}.`,
    '',
    `Reviewer: ${options.reviewerName}`,
    `Issues: ${options.issueCount}`,
    '',
    'Corbel Works',
  ].join('\n');
  await sendMail(options.to, `Trace "${options.traceName}" submitted on ${options.drawingName}`, body);
}
