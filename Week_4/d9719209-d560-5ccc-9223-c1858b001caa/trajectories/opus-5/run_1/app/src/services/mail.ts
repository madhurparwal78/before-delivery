import nodemailer from 'nodemailer';
import { config } from '../core/config.js';

const transport = nodemailer.createTransport({
  host: config.smtp.host,
  port: config.smtp.port,
  secure: false,
  ignoreTLS: true,
  connectionTimeout: 3000,
  greetingTimeout: 3000,
});

/** A mail that cannot be sent never fails the request that caused it. */
async function send(to: string, subject: string, text: string): Promise<void> {
  try {
    await transport.sendMail({ from: config.smtp.from, to, subject, text });
  } catch (error) {
    process.stderr.write(`mail to ${to} not sent: ${(error as Error).message}\n`);
  }
}

function link(path: string): string {
  return `${config.publicUrl}${path}`;
}

export async function sendVerificationMail(to: string, token: string): Promise<void> {
  await send(
    to,
    'Confirm your Moothall email',
    [
      'Welcome to Moothall.',
      '',
      'Confirm your email address to vote, post and reply:',
      link(`/verify?token=${token}`),
      '',
      'If you did not create this account you can ignore this mail.',
    ].join('\n'),
  );
}

export async function sendPasswordResetMail(to: string, token: string): Promise<void> {
  await send(
    to,
    'Reset your Moothall password',
    [
      'You asked to reset your Moothall password.',
      '',
      'Set a new password here:',
      link(`/reset?token=${token}`),
      '',
      'If you did not ask for this you can ignore this mail.',
    ].join('\n'),
  );
}

export async function sendLockoutMail(to: string): Promise<void> {
  await send(
    to,
    'Sign-in attempts on your Moothall account',
    [
      'Your account was locked after repeated failed sign-ins.',
      '',
      'You can reset your password here:',
      link('/forgot'),
    ].join('\n'),
  );
}

export interface StatementOfReasons {
  to: string;
  communityName: string;
  postTitle: string;
  publicReason: string;
  postUrl: string;
}

/** The statement of reasons never carries the moderator's private note. */
export async function sendStatementOfReasons(statement: StatementOfReasons): Promise<void> {
  await send(
    statement.to,
    `Your post in c/${statement.communityName} was removed`,
    [
      `Your post "${statement.postTitle}" was removed.`,
      '',
      `Reason: ${statement.publicReason}`,
      '',
      `This removal was made by the moderators of c/${statement.communityName}.`,
      '',
      link(statement.postUrl),
    ].join('\n'),
  );
}

export async function sendReportConfirmationMail(to: string, reference: string): Promise<void> {
  await send(
    to,
    `Report received: ${reference}`,
    [
      `We received your illegal-content report ${reference}.`,
      '',
      'We will review your report.',
    ].join('\n'),
  );
}
