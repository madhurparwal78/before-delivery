import net from 'node:net';
import { config } from '../config';

export class MailUnavailableError extends Error {}

class SmtpSession {
  private buffer = '';
  private pending: ((line: string) => void) | null = null;
  private failure: Error | null = null;

  constructor(private readonly socket: net.Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.drain();
    });
    socket.on('error', (error) => {
      this.failure = error;
    });
  }

  private drain(): void {
    const match = /(^|\n)(\d{3}) [^\n]*\r?\n/.exec(this.buffer);
    if (match === null || this.pending === null) return;
    const reply = this.buffer.slice(0, match.index + match[0].length);
    this.buffer = this.buffer.slice(match.index + match[0].length);
    const resolve = this.pending;
    this.pending = null;
    resolve(reply.trim());
  }

  async expect(prefix: string): Promise<void> {
    const reply = await new Promise<string>((resolve, reject) => {
      if (this.failure !== null) {
        reject(this.failure);
        return;
      }
      const timer = setTimeout(() => reject(new Error('smtp timed out')), config.providerTimeoutMs);
      this.pending = (line) => {
        clearTimeout(timer);
        resolve(line);
      };
      this.socket.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      this.drain();
    });
    const code = reply.split(/\r?\n/).pop() ?? '';
    if (!code.startsWith(prefix)) throw new Error(`smtp answered ${code}`);
  }

  write(line: string): void {
    this.socket.write(line);
  }
}

function addressOf(mailbox: string): string {
  const match = /<([^>]+)>/.exec(mailbox);
  return match === null ? mailbox.trim() : match[1].trim();
}

function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function message(to: string, subject: string, body: string): string {
  const lines = [
    `From: ${config.mail.from}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    body,
  ];
  return lines.join('\r\n').replace(/\n\./g, '\n..');
}

export async function sendMail(to: string, subject: string, body: string): Promise<void> {
  const socket = net.createConnection({ host: config.mail.host, port: config.mail.port });
  socket.setTimeout(config.providerTimeoutMs);
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
      socket.once('timeout', () => reject(new Error('smtp connect timed out')));
    });
    const session = new SmtpSession(socket);
    await session.expect('220');
    session.write('EHLO cutline\r\n');
    await session.expect('250');
    session.write(`MAIL FROM:<${addressOf(config.mail.from)}> BODY=8BITMIME\r\n`);
    await session.expect('250');
    session.write(`RCPT TO:<${addressOf(to)}>\r\n`);
    await session.expect('250');
    session.write('DATA\r\n');
    await session.expect('354');
    session.write(`${message(to, subject, body)}\r\n.\r\n`);
    await session.expect('250');
    session.write('QUIT\r\n');
  } catch (error) {
    throw new MailUnavailableError(`mail delivery failed: ${String(error)}`);
  } finally {
    socket.destroy();
  }
}
