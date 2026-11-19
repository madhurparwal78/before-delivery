import type pg from 'pg';
import { config } from './config.js';

export async function smtpProbe(): Promise<boolean> {
  const net = await import('node:net');
  return new Promise(resolve => {
    const socket = net.createConnection({ host: config.smtp.host, port: config.smtp.port });
    socket.setTimeout(3000);
    socket.on('connect', () => { socket.end(); resolve(true); });
    socket.on('error', () => resolve(false));
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
  });
}

export interface MailMessage {
  to: string;
  from: string;
  subject: string;
  text: string;
  attachments?: Array<{ filename: string; contentType: string; content: Buffer }>;
}

export async function sendMail(msg: MailMessage, timeoutMs = 5000): Promise<void> {
  const net = await import('node:net');
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: config.smtp.host, port: config.smtp.port });
    socket.setTimeout(timeoutMs);
    let buffer = '';
    let step = 0;
    const fail = (e: Error) => { socket.destroy(); reject(e); };
    socket.on('timeout', () => fail(new Error('smtp timeout')));
    socket.on('error', fail);
    socket.on('connect', () => { buffer = ''; });
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      if (!buffer.endsWith('\r\n')) return;
      const code = parseInt(buffer.slice(0, 3), 10);
      buffer = '';
      if (code >= 400) return fail(new Error(`smtp error ${code}`));
      step++;
      switch (step) {
        case 1: socket.write(`EHLO nightroll\r\n`); break;
        case 2: socket.write(`MAIL FROM:<${fromAddress(msg.from)}>\r\n`); break;
        case 3: socket.write(`RCPT TO:<${msg.to}>\r\n`); break;
        case 4: socket.write(`DATA\r\n`); break;
        case 5: {
          const body = buildMime(msg);
          socket.write(body);
          socket.write(`\r\n.\r\n`);
          break;
        }
        case 6: socket.write(`QUIT\r\n`); socket.end(); resolve(); break;
      }
    });
  });
}

function fromAddress(from: string): string {
  const match = from.match(/<([^>]+)>/);
  return match ? match[1] : from;
}

function buildMime(msg: MailMessage): string {
  const headers = [
    `From: ${msg.from}`,
    `To: ${msg.to}`,
    `Subject: ${encodeHeader(msg.subject)}`,
    `MIME-Version: 1.0`,
    msg.attachments?.length
      ? `Content-Type: multipart/mixed; boundary="nightroll-boundary"`
      : `Content-Type: text/plain; charset=utf-8`,
    ``,
    ``
  ];
  if (!msg.attachments?.length) return headers.join('\r\n') + msg.text.replace(/\n/g, '\r\n');
  const parts = msg.attachments.map(a =>
    [
      `--nightroll-boundary`,
      `Content-Type: ${a.contentType}; name="${a.filename}"`,
      `Content-Disposition: attachment; filename="${a.filename}"`,
      `Content-Transfer-Encoding: base64`,
      ``,
      a.content.toString('base64').replace(/(.{76})/g, '$1\r\n')
    ].join('\r\n'));
  return headers.join('\r\n')
    + [`--nightroll-boundary`, `Content-Type: text/plain; charset=utf-8`, ``, msg.text.replace(/\n/g, '\r\n')].join('\r\n')
    + '\r\n' + parts.join('\r\n') + '\r\n'
    + '--nightroll-boundary--\r\n';
}

function encodeHeader(subject: string): string {
  const isAsciiOnly = /^\p{ASCII}*$/u.test(subject);
  return isAsciiOnly ? subject : `=?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`;
}

export async function ensureSmtpReady(): Promise<boolean> {
  return smtpProbe();
}
