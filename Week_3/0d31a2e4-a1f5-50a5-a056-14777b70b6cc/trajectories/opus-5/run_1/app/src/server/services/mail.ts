import { config } from '../config.js';
import { type SmtpOptions, probe, send } from './smtp.js';

/** The app decides mail is unreachable within five seconds of trying. */
const MAIL_TIMEOUT_MS = 4500;
const FROM = { name: 'Pratfall Cup', address: 'no-reply@wobblewell.test' };
const EXPIRY_LINE = 'This link expires in 30 minutes.';

export type LinkKind = 'verification' | 'reset';

const options: SmtpOptions = {
  host: config.smtpHost,
  port: config.smtpPort,
  timeoutMs: MAIL_TIMEOUT_MS,
};

const SUBJECTS: Record<LinkKind, string> = {
  verification: 'Verify your Pratfall Cup email',
  reset: 'Reset your Pratfall Cup password',
};

function linkFor(kind: LinkKind, token: string): string {
  const path = kind === 'verification' ? 'verify' : 'reset-password';
  return `${config.publicUrl.replace(/\/$/, '')}/${path}?token=${token}`;
}

function bodyFor(kind: LinkKind, link: string): string {
  const intro =
    kind === 'verification'
      ? 'Welcome to Pratfall Cup. Verify your email to add friends and find matches:'
      : 'Set a new Pratfall Cup password here:';
  return `${intro}\n\n${link}\n\n${EXPIRY_LINE}\n`;
}

/** Checks whether Mailpit can be reached, without sending anything. */
export async function probeMail(): Promise<boolean> {
  return probe(options);
}

/** Sends one link message. Resolves false when Mailpit cannot be reached. */
export async function sendLinkMail(kind: LinkKind, to: string, token: string): Promise<boolean> {
  return send(options, {
    from: FROM,
    to,
    subject: SUBJECTS[kind],
    text: bodyFor(kind, linkFor(kind, token)),
  });
}
