import { Socket } from 'node:net';

const CRLF = '\r\n';
const SMTP_TIMEOUT_MS = 8000;
const EHLO_DOMAIN = 'fernhollow.test';

export interface SmtpEnvelope {
  fromName: string;
  fromAddress: string;
  toName: string;
  toAddress: string;
  subject: string;
  text: string;
  messageId: string;
}

/** RFC 2047 encoding, used only when a header value leaves US-ASCII. */
function headerValue(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function dotStuff(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => (line.startsWith('.') ? `.${line}` : line))
    .join(CRLF);
}

class SmtpSession {
  private buffer = '';
  private readonly waiters: { expect: number; resolve: () => void; reject: (error: Error) => void }[] = [];

  constructor(private readonly socket: Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => this.consume(chunk));
    socket.on('error', (error) => this.failAll(error));
    socket.on('close', () => this.failAll(new Error('smtp connection closed')));
  }

  private failAll(error: Error): void {
    while (this.waiters.length > 0) {
      this.waiters.shift()?.reject(error);
    }
  }

  private consume(chunk: string): void {
    this.buffer += chunk;
    for (;;) {
      const lines = this.buffer.split(CRLF);
      const finalIndex = lines.findIndex((line) => /^\d{3} /.test(line));
      if (finalIndex === -1) return;
      const finalLine = lines[finalIndex] ?? '';
      this.buffer = lines.slice(finalIndex + 1).join(CRLF);
      const code = Number(finalLine.slice(0, 3));
      const waiter = this.waiters.shift();
      if (!waiter) continue;
      if (Math.floor(code / 100) === Math.floor(waiter.expect / 100)) waiter.resolve();
      else waiter.reject(new Error(`smtp refused: ${finalLine}`));
    }
  }

  expect(code: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.waiters.push({ expect: code, resolve, reject });
    });
  }

  async send(line: string, expected: number): Promise<void> {
    const waiting = this.expect(expected);
    this.socket.write(line + CRLF);
    await waiting;
  }

  writeRaw(text: string): void {
    this.socket.write(text);
  }
}

/** Delivers one message over plain SMTP and resolves once the server accepts it. */
export async function sendMail(host: string, port: number, envelope: SmtpEnvelope): Promise<void> {
  const socket = new Socket();
  socket.setTimeout(SMTP_TIMEOUT_MS);
  const session = new SmtpSession(socket);
  const greeting = session.expect(220);

  await new Promise<void>((resolve, reject) => {
    socket.once('error', reject);
    socket.once('timeout', () => reject(new Error('smtp connection timed out')));
    socket.connect(port, host, () => resolve());
  });

  try {
    await greeting;
    await session.send(`EHLO ${EHLO_DOMAIN}`, 250);
    await session.send(`MAIL FROM:<${envelope.fromAddress}>`, 250);
    await session.send(`RCPT TO:<${envelope.toAddress}>`, 250);
    await session.send('DATA', 354);

    const headers = [
      `From: ${headerValue(envelope.fromName)} <${envelope.fromAddress}>`,
      `To: ${headerValue(envelope.toName)} <${envelope.toAddress}>`,
      `Subject: ${headerValue(envelope.subject)}`,
      `Message-ID: ${envelope.messageId}`,
      `Date: ${new Date().toUTCString()}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: 8bit',
    ].join(CRLF);

    const accepted = session.expect(250);
    session.writeRaw(`${headers}${CRLF}${CRLF}${dotStuff(envelope.text)}${CRLF}.${CRLF}`);
    await accepted;
    await session.send('QUIT', 221).catch(() => undefined);
  } finally {
    socket.destroy();
  }
}
