import { createConnection } from 'node:net';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';

export class MailUnreachable extends Error {}

interface SmtpSession {
  send(command: string, expected: number): Promise<void>;
  sendData(body: string): Promise<void>;
  close(): void;
}

function openSession(): Promise<SmtpSession> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: config.mail.host, port: config.mail.port });
    socket.setTimeout(10_000);
    let buffer = '';
    let waiting: ((line: string) => void) | null = null;
    const fail = (error: Error): void => {
      socket.destroy();
      if (waiting === null) reject(new MailUnreachable(error.message));
      else waiting(`500 ${error.message}`);
    };
    socket.on('error', fail);
    socket.on('timeout', () => fail(new Error('SMTP timed out')));
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const complete = /(^|\n)(\d{3}) [^\n]*\r?\n$/.test(buffer);
      if (complete && waiting !== null) {
        const line = buffer;
        buffer = '';
        const resume = waiting;
        waiting = null;
        resume(line);
      }
    });
    const read = (): Promise<string> =>
      new Promise((resolveLine) => {
        waiting = resolveLine;
      });
    const expect = async (expected: number): Promise<void> => {
      const line = await read();
      const code = Number.parseInt(/(\d{3}) [^\n]*\r?\n$/.exec(line)?.[1] ?? '500', 10);
      if (code !== expected) throw new MailUnreachable(`SMTP answered ${code}`);
    };
    const session: SmtpSession = {
      async send(command: string, expected: number): Promise<void> {
        socket.write(`${command}\r\n`);
        await expect(expected);
      },
      async sendData(body: string): Promise<void> {
        socket.write(`${body.replace(/\n\./g, '\n..')}\r\n.\r\n`);
        await expect(250);
      },
      close(): void {
        socket.destroy();
      },
    };
    expect(220).then(() => resolve(session), reject);
  });
}

export interface Mail {
  readonly to: string;
  readonly subject: string;
  readonly body: string;
}

function envelopeAddress(address: string): string {
  const match = /<([^>]+)>/.exec(address);
  return match === null ? address.trim() : match[1];
}

function encodeHeader(value: string): string {
  return /^[\x20-\x7e]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

export async function sendMail(mail: Mail): Promise<void> {
  let session: SmtpSession | null = null;
  try {
    session = await openSession();
    await session.send('EHLO tidewright', 250);
    await session.send(`MAIL FROM:<${envelopeAddress(config.mail.from)}>`, 250);
    await session.send(`RCPT TO:<${envelopeAddress(mail.to)}>`, 250);
    await session.send('DATA', 354);
    const headers = [
      `From: ${config.mail.from}`,
      `To: ${mail.to}`,
      `Subject: ${encodeHeader(mail.subject)}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${randomUUID()}@tidewright>`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: 8bit',
    ].join('\r\n');
    await session.sendData(`${headers}\r\n\r\n${mail.body.replace(/\n/g, '\r\n')}`);
    await session.send('QUIT', 221);
  } catch (error) {
    throw error instanceof MailUnreachable ? error : new MailUnreachable(String(error));
  } finally {
    session?.close();
  }
}
