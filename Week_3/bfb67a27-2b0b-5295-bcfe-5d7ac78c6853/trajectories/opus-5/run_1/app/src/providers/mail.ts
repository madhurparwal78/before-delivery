import { createConnection, type Socket } from 'node:net';
import { config, LIMITS } from '../server/config.js';

/** Thrown when the mail server refuses or does not accept a message. */
export class MailUnavailableError extends Error {}

const CRLF = '\r\n';

function envelopeAddress(mailbox: string): string {
  const angled = /<([^>]+)>/.exec(mailbox);
  return (angled?.[1] ?? mailbox).trim();
}

/** RFC 2047 encoding so the published subjects survive as sent. */
function encodeHeader(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function base64Lines(value: string): string {
  const encoded = Buffer.from(value, 'utf8').toString('base64');
  return (encoded.match(/.{1,76}/g) ?? ['']).join(CRLF);
}

interface SmtpSession {
  send: (command: string, expected: number) => Promise<string>;
  end: () => void;
}

/** A single plain SMTP conversation, failing on any reply the RFC calls an error. */
function openSession(host: string, port: number, timeoutMs: number): Promise<SmtpSession> {
  return new Promise((resolve, reject) => {
    const socket: Socket = createConnection({ host, port });
    socket.setTimeout(timeoutMs);
    let buffer = '';
    let waiting: ((reply: string) => void) | null = null;
    let failed: ((error: Error) => void) | null = null;

    const fail = (error: Error): void => {
      socket.destroy();
      if (failed !== null) failed(error);
      else reject(error);
    };

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const complete = /^\d{3} [^\r\n]*\r\n/m.test(buffer) && /\r\n$/.test(buffer);
      if (!complete || waiting === null) return;
      const reply = buffer;
      buffer = '';
      const resolveReply = waiting;
      waiting = null;
      failed = null;
      resolveReply(reply);
    });
    socket.on('error', (error) => fail(new MailUnavailableError(error.message)));
    socket.on('timeout', () => fail(new MailUnavailableError('mail server timed out')));
    socket.on('close', () => {
      if (waiting !== null) fail(new MailUnavailableError('mail server closed the connection'));
    });

    const expect = (expected: number): Promise<string> =>
      new Promise((resolveReply, rejectReply) => {
        waiting = (reply: string) => {
          const code = Number(reply.slice(0, 3));
          if (code !== expected) {
            socket.destroy();
            rejectReply(new MailUnavailableError(`mail server answered ${reply.trim()}`));
            return;
          }
          resolveReply(reply);
        };
        failed = rejectReply;
      });

    const send = async (command: string, expected: number): Promise<string> => {
      const reply = expect(expected);
      socket.write(command + CRLF);
      return reply;
    };

    expect(220).then(
      () => resolve({ send, end: () => socket.destroy() }),
      (error: unknown) => reject(error),
    );
  });
}

/** Resolves only once the mail server has accepted the message. */
export async function sendMail(to: string, subject: string, body: string): Promise<void> {
  const from = envelopeAddress(config.mail.from);
  const message = [
    `From: ${encodeHeader(config.mail.from)}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(body),
  ].join(CRLF);

  let session: SmtpSession | null = null;
  try {
    session = await openSession(config.mail.host, config.mail.port, LIMITS.providerTimeoutMs);
    await session.send('EHLO tallyslate', 250);
    await session.send(`MAIL FROM:<${from}>`, 250);
    await session.send(`RCPT TO:<${to}>`, 250);
    await session.send('DATA', 354);
    await session.send(`${message}${CRLF}.`, 250);
    await session.send('QUIT', 221);
  } catch (cause) {
    if (cause instanceof MailUnavailableError) throw cause;
    throw new MailUnavailableError(`Mail server did not accept "${subject}"`, { cause });
  } finally {
    session?.end();
  }
}
