import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';

const SMTP_TIMEOUT_MS = 8000;

export interface Mail { to: string; subject: string; text: string }

/** Minimal plain-text SMTP delivery to the configured sink. */
function deliver(mail: Mail, host: string, port: number): Promise<void> {
  const sender = /<([^>]+)>/.exec(config.mailFrom)?.[1] ?? config.mailFrom.trim();
  const body = [
    `From: ${config.mailFrom}`,
    `To: ${mail.to}`,
    `Subject: ${mail.subject}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@moothall>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    ...mail.text.split(/\r?\n/),
  ].map((line) => (line.startsWith('.') ? `.${line}` : line)).join('\r\n');

  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    socket.setTimeout(SMTP_TIMEOUT_MS, () => socket.destroy(new Error('SMTP timeout')));
    const script = [
      { send: `EHLO moothall`, expect: '250' },
      { send: `MAIL FROM:<${sender}>`, expect: '250' },
      { send: `RCPT TO:<${mail.to}>`, expect: '250' },
      { send: 'DATA', expect: '354' },
      { send: `${body}\r\n.`, expect: '250' },
      { send: 'QUIT', expect: '221' },
    ];
    let step = -1;
    let pending = '';
    socket.on('error', reject);
    socket.on('close', () => (step >= script.length - 1 ? resolve() : reject(new Error('SMTP closed early'))));
    socket.on('data', (chunk: Buffer) => {
      pending += chunk.toString('utf8');
      const lines = pending.split('\r\n');
      pending = lines.pop() ?? '';
      for (const line of lines) {
        if (/^\d{3}-/.test(line)) continue;
        const expected = step < 0 ? '220' : script[step]?.expect;
        if (!line.startsWith(expected ?? '')) {
          socket.destroy(new Error(`SMTP refused: ${line}`));
          return;
        }
        step += 1;
        const next = script[step];
        if (next) socket.write(`${next.send}\r\n`);
        else socket.end();
      }
    });
  });
}

/** Sends one mail. A mail that cannot be sent never fails the request that caused it. */
export async function sendMail(mail: Mail): Promise<void> {
  if (!config.smtpHost || !config.smtpPort) return;
  try {
    await deliver(mail, config.smtpHost, config.smtpPort);
  } catch (error) {
    console.error('mail not sent:', error instanceof Error ? error.message : error);
  }
}

const absolute = (path: string): string => new URL(path, config.publicUrl).toString();

export const mails = {
  verification: (to: string, token: string): Mail => ({
    to,
    subject: 'Confirm your Moothall email',
    text: `Welcome to Moothall.\n\nConfirm your email address to vote, post and reply:\n${absolute(`/verify?token=${token}`)}\n\nIf you did not create an account you can ignore this mail.`,
  }),
  passwordReset: (to: string, token: string): Mail => ({
    to,
    subject: 'Reset your Moothall password',
    text: `Someone asked to reset the password of your Moothall account.\n\nChoose a new password here:\n${absolute(`/reset?token=${token}`)}\n\nIf this was not you, ignore this mail.`,
  }),
  lockout: (to: string): Mail => ({
    to,
    subject: 'Sign-in attempts on your Moothall account',
    text: `Your account was locked after repeated failed sign-ins.\n\nIf this was you, wait and try again, or reset your password:\n${absolute('/forgot')}`,
  }),
  statementOfReasons: (to: string, community: string, postId: string, title: string, reason: string): Mail => ({
    to,
    subject: `Your post in c/${community} was removed`,
    text: `Your post "${title}" was removed.\n\nReason: ${reason}\n\nThis removal was made by the moderators of c/${community}.\n\nPost: ${absolute(`/c/${community}/post/${postId}`)}`,
  }),
  reportConfirmation: (to: string, reference: string): Mail => ({
    to,
    subject: `Report received: ${reference}`,
    text: `Your reference is ${reference}.\n\nWe will review your report.`,
  }),
};
