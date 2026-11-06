import { Socket } from 'node:net';
import { config } from './config.js';

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

const CRLF = '\r\n';

class SmtpSession {
  private socket: Socket;
  private buffer = '';
  private replies: string[] = [];

  constructor(socket: Socket) {
    this.socket = socket;
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.pump();
    });
  }

  private pump(): void {
    // A reply is a code, an optional '-', and text; the last line of a
    // multiline reply carries no dash.
    while (true) {
      const idx = this.buffer.indexOf(CRLF);
      if (idx === -1) return;
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + CRLF.length);
      if (line.length >= 4 && line[3] === '-') continue;
      this.replies.push(line);
    }
  }

  expect(): Promise<string> {
    const queued = this.replies.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    return new Promise((resolve) => {
      const poll = () => {
        const line = this.replies.shift();
        if (line !== undefined) resolve(line);
        else setTimeout(poll, 10);
      };
      poll();
    });
  }

  send(line: string): void {
    this.socket.write(line + CRLF);
  }

  end(): void {
    this.socket.end();
  }
}

function encodeHeader(value: string): string {
  return value.replace(/[\r\n]/g, ' ');
}

function dotStuff(body: string): string {
  return body.split('\n').map((line) => (line.startsWith('.') ? `.${line}` : line)).join('\n');
}

async function command(session: SmtpSession, line: string, expected: number): Promise<void> {
  session.send(line);
  const reply = await session.expect();
  const code = Number(reply.slice(0, 3));
  if (code !== expected) throw new Error('rejected');
}

// Sends one email over SMTP; true when the mail service accepted it.
export function deliver(email: OutgoingEmail): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket();
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        // already closed
      }
      resolve(ok);
    };
    const session = new SmtpSession(socket);
    socket.setTimeout(3000, () => finish(false));
    socket.once('error', () => finish(false));
    socket.once('close', () => finish(false));
    socket.connect(config.smtpPort, config.smtpHost, () => {
      void (async () => {
        try {
          const greeting = await session.expect();
          if (!greeting.startsWith('220')) throw new Error('greeting');
          await command(session, 'EHLO stillhour.local', 250);
          await command(session, `MAIL FROM:<${envelopeAddress(config.mailFrom)}>`, 250);
          await command(session, `RCPT TO:<${email.to}>`, 250);
          await command(session, 'DATA', 354);
          const boundary = 'stillhour-' + Date.now().toString(36);
          const content = [
            'From: ' + encodeHeader(config.mailFrom),
            `To: <${email.to}>`,
            'Subject: ' + encodeHeader(email.subject),
            `Date: ${new Date().toUTCString()}`,
            'MIME-Version: 1.0',
            `Content-Type: multipart/alternative; boundary="${boundary}"`,
            '',
            `--${boundary}`,
            'Content-Type: text/plain; charset=utf-8',
            '',
            email.text,
            '',
            `--${boundary}`,
            'Content-Type: text/html; charset=utf-8',
            '',
            email.html,
            '',
            `--${boundary}--`,
          ].join(CRLF);
          session.send(dotStuff(content));
          session.send('.');
          const accepted = await session.expect();
          if (!accepted.startsWith('250')) throw new Error('data');
          session.send('QUIT');
          finish(true);
        } catch {
          finish(false);
        }
      })();
    });
  });
}

// "Stillhour <goodnight@stillhour.example>" -> goodnight@stillhour.example
function envelopeAddress(from: string): string {
  const match = /<([^>]+)>/.exec(from);
  return match ? match[1]! : from.trim();
}
