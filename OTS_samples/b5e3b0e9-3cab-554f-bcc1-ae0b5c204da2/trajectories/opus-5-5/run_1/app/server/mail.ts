import { createConnection, type Socket } from 'node:net';
import { randomBytes } from 'node:crypto';
import { config } from './config.js';
import { ApiError } from './http.js';

const mailUnavailable = () =>
  new ApiError(503, { error: 'mail_unavailable', message: 'Mail cannot be sent right now. Try again shortly.' });

function envelopeAddress(value: string): string {
  const match = /<([^>]+)>/.exec(value);
  return (match ? match[1]! : value).trim();
}

class SmtpConversation {
  private buffer = '';
  private waiting: ((line: string) => void) | null = null;
  private failure: Error | null = null;

  constructor(private readonly socket: Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.flush();
    });
    socket.on('error', (error) => this.fail(error));
    socket.on('close', () => this.fail(new Error('SMTP connection closed')));
  }

  private fail(error: Error): void {
    this.failure ??= error;
    if (this.waiting) this.waiting('');
  }

  private flush(): void {
    if (!this.waiting) return;
    const lines = this.buffer.split('\r\n');
    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i]!;
      if (/^\d{3} /.test(line) || /^\d{3}$/.test(line)) {
        this.buffer = lines.slice(i + 1).join('\r\n');
        const resolve = this.waiting;
        this.waiting = null;
        resolve(line);
        return;
      }
    }
  }

  reply(): Promise<string> {
    return new Promise((resolve, reject) => {
      if (this.failure) return reject(this.failure);
      this.waiting = (line) => (this.failure && !line ? reject(this.failure) : resolve(line));
      this.flush();
    });
  }

  async expect(command: string | null, code: string): Promise<void> {
    if (command !== null) this.socket.write(`${command}\r\n`);
    const line = await this.reply();
    if (!line.startsWith(code)) throw new Error(`SMTP refused: ${line}`);
  }
}

export async function sendMail(to: string, subject: string, body: string): Promise<void> {
  const socket = createConnection({ host: config.smtp.host, port: config.smtp.port });
  socket.setTimeout(10_000, () => socket.destroy(new Error('SMTP timeout')));
  const smtp = new SmtpConversation(socket);
  try {
    await smtp.expect(null, '220');
    await smtp.expect('EHLO runupbay.local', '250');
    await smtp.expect(`MAIL FROM:<${envelopeAddress(config.smtp.from)}>`, '250');
    await smtp.expect(`RCPT TO:<${to}>`, '25');
    await smtp.expect('DATA', '354');
    const message = [
      `From: ${config.smtp.from}`,
      `To: <${to}>`,
      `Subject: ${subject}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${randomBytes(12).toString('hex')}@runupbay.local>`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      ...body.split('\n').map((line) => (line.startsWith('.') ? `.${line}` : line)),
    ].join('\r\n');
    await smtp.expect(`${message}\r\n.`, '250');
    socket.write('QUIT\r\n');
  } finally {
    socket.end();
  }
}

export async function sendMailOrUnavailable(to: string, subject: string, body: string): Promise<void> {
  try {
    await sendMail(to, subject, body);
  } catch {
    throw mailUnavailable();
  }
}
