import net from 'node:net';
import { env } from '../env.js';
import { markService } from './health.js';

export interface OutgoingMail {
  to: string;
  subject: string;
  body: string;
}

/** Thrown when the mail server cannot be reached, so the outbox keeps the message. */
class MailUnreachable extends Error {
  constructor(reason: string) {
    super(`mail server unreachable: ${reason}`);
    this.name = 'MailUnreachable';
  }
}

function addressOnly(from: string): string {
  const angled = /<([^>]+)>/.exec(from);
  return angled ? angled[1]! : from.trim();
}

function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  return /^[\x20-\x7e]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function message(mail: OutgoingMail): string {
  const base64 = Buffer.from(mail.body, 'utf8').toString('base64');
  const lines: string[] = [
    `From: ${env.mail.from}`,
    `To: ${mail.to}`,
    `Subject: ${encodeHeader(mail.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
  ];
  for (let index = 0; index < base64.length; index += 76) {
    lines.push(base64.slice(index, index + 76));
  }
  return lines.join('\r\n');
}

/** A minimal SMTP conversation: Mailpit takes plain, unauthenticated submissions. */
export function sendMail(mail: OutgoingMail): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: env.mail.smtpHost, port: env.mail.smtpPort });
    socket.setTimeout(15_000);
    socket.setEncoding('utf8');

    const steps: string[] = [
      `EHLO ceibo`,
      `MAIL FROM:<${addressOnly(env.mail.from)}>`,
      `RCPT TO:<${mail.to}>`,
      'DATA',
    ];
    let stepIndex = -1;
    let inData = false;
    let buffer = '';
    let settled = false;

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      markService('mailpit', false);
      reject(error);
    };
    const done = () => {
      if (settled) return;
      settled = true;
      socket.end('QUIT\r\n');
      markService('mailpit', true);
      resolve();
    };

    socket.on('error', (error) => fail(new MailUnreachable(error.message)));
    socket.on('timeout', () => fail(new MailUnreachable('timed out')));
    socket.on('close', () => fail(new MailUnreachable('closed early')));

    socket.on('data', (chunk: string) => {
      buffer += chunk;
      let newline = buffer.indexOf('\r\n');
      while (newline !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 2);
        newline = buffer.indexOf('\r\n');
        if (/^\d{3}-/.test(line)) continue;

        const code = Number(line.slice(0, 3));
        if (code >= 400) {
          fail(new Error(`SMTP refused the message: ${line}`));
          return;
        }
        if (inData) {
          done();
          return;
        }
        stepIndex += 1;
        const next = steps[stepIndex];
        if (next === undefined) {
          inData = true;
          const dotStuffed = message(mail).replace(/^\./gm, '..');
          socket.write(`${dotStuffed}\r\n.\r\n`);
          continue;
        }
        socket.write(`${next}\r\n`);
      }
    });
  });
}
