import net from 'node:net';
import { config } from '../config.js';

// A minimal SMTP client. Delivery counts only when the server accepts the end
// of the message (the final "."), which is when the caller marks it sent.

const CONNECT_TIMEOUT_MS = 5_000;

interface SmtpSession {
  socket: net.Socket;
  buffer: string;
  read(): Promise<string>;
  expect(code: number): Promise<void>;
  command(cmd: string, code: number): Promise<void>;
  close(): void;
}

function connect(host: string, port: number): Promise<SmtpSession> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(CONNECT_TIMEOUT_MS);
    const session: SmtpSession = {
      socket,
      buffer: '',
      read() {
        return new Promise((resolveRead, rejectRead) => {
          const onReadable = () => {
            const chunk = socket.read();
            if (chunk !== null) {
              session.buffer += chunk.toString('utf8');
            }
            const done = endsWithResponse(session.buffer);
            if (done !== null) {
              socket.off('readable', onReadable);
              session.buffer = session.buffer.slice(done.length);
              resolveRead(done);
              return;
            }
          };
          const onError = (err: Error) => { socket.off('readable', onReadable); rejectRead(err); };
          socket.on('readable', onReadable);
          socket.once('error', onError);
          onReadable();
        });
      },
      async expect(code: number) {
        const response = (await session.read()).replace(/^[\r\n]+/, '');
        if (!response.startsWith(String(code))) {
          throw new Error(`SMTP expected ${code}, got: ${response.slice(0, 120)}`);
        }
      },
      async command(cmd: string, code: number) {
        await new Promise<void>((resolveWrite, rejectWrite) => {
          socket.write(cmd + '\r\n', (err) => (err ? rejectWrite(err) : resolveWrite()));
        });
        await session.expect(code);
      },
      close() {
        try { socket.destroy(); } catch { /* already closed */ }
      },
    };
    socket.once('connect', () => {
      socket.setTimeout(0);
      resolve(session);
    });
    socket.once('error', reject);
    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error('SMTP connection timed out'));
    });
  });
}

// An SMTP response ends with a line like "250 " (space, not dash).
function endsWithResponse(buffer: string): string | null {
  const lines = buffer.split('\r\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    if (line === '') continue;
    if (/^\d{3} /.test(line)) return lines.slice(0, i + 1).join('\r\n');
    if (/^\d{3}-/.test(line)) return null;
    return null;
  }
  return null;
}

export interface MailMessage {
  messageId: string;
  to: string;
  subject: string;
  text: string;
}

export async function sendMail(message: MailMessage): Promise<'sent'> {
  const session = await connect(config.smtp.host, config.smtp.port);
  try {
    await session.expect(220);
    await session.command('EHLO seatweaver', 250);
    await session.command('MAIL FROM:<dispatch@fernhollow.test>', 250);
    await session.command(`RCPT TO:<${message.to}>`, 250);
    await session.command('DATA', 354);
    const body = [
      'From: Fernhollow Access Dispatch <dispatch@fernhollow.test>',
      `To: ${message.to}`,
      `Subject: ${message.subject}`,
      `Message-ID: <${message.messageId}>`,
      `Date: ${new Date().toUTCString()}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      '',
      ...message.text.split('\n').map((line) => (line.startsWith('.') ? `.${line}` : line)),
      '.',
    ].join('\r\n');
    await new Promise<void>((resolveWrite, rejectWrite) => {
      session.socket.write(body + '\r\n', (err) => (err ? rejectWrite(err) : resolveWrite()));
    });
    await session.expect(250);
    await session.command('QUIT', 221);
    return 'sent';
  } finally {
    session.close();
  }
}

export async function probeMail(): Promise<boolean> {
  try {
    const res = await fetch(`${config.smtp.mailpitUrl}/api/v1/messages?limit=1`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}
