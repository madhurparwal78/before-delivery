// Minimal SMTP client (MAIL FROM / RCPT TO / DATA) — no dependencies.

import * as net from 'node:net';

export interface MailMessage {
  to: string;
  subject: string;
  body: string;
  ics?: string;
  replyTo?: string;
}

function encodeHeader(value: string): string {
  // One line only; CRLF injection is impossible because callers reject line breaks.
  return value.replace(/\r?\n/g, ' ');
}

export async function sendMail(host: string, port: number, from: string, message: MailMessage): Promise<void> {
  const socket: net.Socket = await new Promise((resolve, reject) => {
    const s = net.connect({ host, port });
    s.once('connect', () => resolve(s));
    s.once('error', reject);
  });
  try {
    await readReply(socket);
    await command(socket, 'EHLO plumbline');
    // The envelope takes the bare address; the display name lives in the header.
    const fromAddress = from.replace(/.*<([^>]*)>/, '$1');
    await command(socket, `MAIL FROM:<${fromAddress}>`);
    await command(socket, `RCPT TO:<${message.to}>`);
    await command(socket, 'DATA');
    const headers = [
      `From: ${from}`,
      `To: <${message.to}>`,
      `Subject: ${encodeHeader(message.subject)}`,
      'MIME-Version: 1.0',
    ];
    if (message.replyTo) headers.push(`Reply-To: <${message.replyTo}>`);
    if (message.ics) {
      headers.push('Content-Type: multipart/mixed; boundary="plumbline-ics"');
    } else {
      headers.push('Content-Type: text/plain; charset=utf-8');
    }
    let body: string;
    if (message.ics) {
      body = [
        '--plumbline-ics',
        'Content-Type: text/plain; charset=utf-8',
        '',
        message.body.replace(/\n/g, '\r\n'),
        '--plumbline-ics',
        'Content-Type: text/calendar; method=REQUEST; charset=utf-8',
        'Content-Disposition: attachment; filename="tender-close.ics"',
        '',
        message.ics.replace(/\r?\n/g, '\r\n'),
        '--plumbline-ics--',
        '',
      ].join('\r\n');
    } else {
      body = `${message.body.replace(/\n/g, '\r\n')}\r\n`;
    }
    const wire = `${headers.join('\r\n')}\r\n\r\n${body}`;
    socket.write(wire.replace(/\r\n\./g, '\r\n..') + '\r\n.\r\n');
    await readReply(socket);
    await command(socket, 'QUIT');
  } finally {
    socket.destroy();
  }
}

function readReply(socket: net.Socket): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      if (!buffer.endsWith('\r\n')) return;
      const lines = buffer.split('\r\n').filter((line) => line.length > 0);
      const last = lines[lines.length - 1] ?? '';
      // A reply ends at a final line (three digits, space, no continuation dash).
      if (!/^\d{3} /.test(last)) return;
      const code = parseInt(last.slice(0, 3), 10);
      socket.removeListener('data', onData);
      if (code >= 400) {
        reject(new Error(`smtp error: ${buffer.trim()}`));
      } else {
        resolve(buffer);
      }
    };
    socket.on('data', onData);
    socket.once('error', reject);
  });
}

async function command(socket: net.Socket, line: string): Promise<void> {
  socket.write(`${line}\r\n`);
  await readReply(socket);
}
