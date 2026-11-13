import { connect } from 'node:net';
import { randomUUID } from 'node:crypto';
import { config } from './config';
import { inOutage } from './outage';

/** The mail server cannot be reached, or refused the message. */
export class MailUnavailableError extends Error {
  constructor() {
    super('mail is unavailable');
  }
}

interface Message {
  to: string;
  subject: string;
  text: string;
}

const addressOf = (from: string): string => from.slice(from.indexOf('<') + 1, from.indexOf('>'));

const header = (value: string): string =>
  /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value).toString('base64')}?=`;

/** Speak just enough SMTP to hand one plain-text message to the server. */
export async function sendMail(message: Message): Promise<void> {
  if (inOutage('mail')) {
    throw new MailUnavailableError();
  }
  const from = config.smtp.from;
  const body = [
    `From: ${from}`,
    `To: ${message.to}`,
    `Subject: ${header(message.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@galley>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    message.text.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..'),
  ].join('\r\n');

  await new Promise<void>((resolve, reject) => {
    const socket = connect({ host: config.smtp.host, port: config.smtp.port });
    socket.setTimeout(8000);
    const steps: [string | null, number][] = [
      [null, 220],
      ['EHLO galley', 250],
      [`MAIL FROM:<${addressOf(from)}>`, 250],
      [`RCPT TO:<${message.to}>`, 250],
      ['DATA', 354],
      [`${body}\r\n.`, 250],
      ['QUIT', 221],
    ];
    let step = 0;
    let buffer = '';
    const fail = (): void => {
      socket.destroy();
      reject(new MailUnavailableError());
    };
    socket.on('error', fail);
    socket.on('timeout', fail);
    socket.on('close', () => (step < steps.length ? fail() : resolve()));
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\r\n');
      const last = lines[lines.length - 2];
      if (!buffer.endsWith('\r\n') || last === undefined || /^\d{3}-/.test(last)) {
        return;
      }
      buffer = '';
      const expected = steps[step];
      if (expected === undefined || !last.startsWith(String(expected[1]))) {
        fail();
        return;
      }
      step += 1;
      const next = steps[step];
      if (next?.[0]) {
        socket.write(`${next[0]}\r\n`);
      } else if (next === undefined) {
        socket.end();
      }
    });
  });
}
