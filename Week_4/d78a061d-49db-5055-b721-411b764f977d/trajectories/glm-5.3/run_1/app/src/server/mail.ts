import net from 'node:net';
import config from './config.js';

export class MailUnavailable extends Error {}

function encodeHeader(value: string): string {
  // Header values are ASCII-safe in this product (subjects are plain UTF-8 words).
  return value.replace(/[\r\n]/g, '');
}

function encodeQuotedPrintable(text: string): string {
  const bytes = Buffer.from(text, 'utf8');
  let out = '';
  for (const byte of bytes) {
    const c = String.fromCharCode(byte);
    if (byte === 13) out += '\r';
    else if (byte === 10) out += '\n';
    else if (byte === 32 || (byte >= 33 && byte <= 126 && c !== '=')) out += c;
    else out += '=' + byte.toString(16).toUpperCase().padStart(2, '0');
  }
  return out;
}

function base64Wrap(text: string): string {
  const b64 = Buffer.from(text, 'utf8').toString('base64');
  const lines = b64.match(/.{1,76}/g) ?? [];
  return lines.join('\r\n');
}

export interface Mail {
  to: string;
  subject: string;
  html: string;
  text: string;
  lang: 'en' | 'ja' | 'es';
}

export function buildMime(mail: Mail): string {
  const boundary = 'lw-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  const headers = [
    `From: ${encodeHeader(config.smtp.from)}`,
    `To: ${encodeHeader(mail.to)}`,
    `Subject: =?UTF-8?B?${Buffer.from(mail.subject, 'utf8').toString('base64')}?=`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    'X-LW-Language: ' + mail.lang,
  ];
  const parts = [
    `--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n${encodeQuotedPrintable(mail.text)}`,
    `--${boundary}\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${base64Wrap(mail.html)}`,
    `--${boundary}--`,
  ];
  return `${headers.join('\r\n')}\r\n\r\n${parts.join('\r\n')}\r\n.\r\n`;
}

export async function sendMail(mail: Mail): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = net.createConnection({ host: config.smtp.host, port: config.smtp.port });
    let buffer = '';
    let stage = 0;
    let mimeSent = false;
    const fail = (err: Error) => {
      socket.destroy();
      reject(err);
    };
    socket.setTimeout(5000, () => fail(new MailUnavailable()));
    socket.on('error', () => fail(new MailUnavailable()));
    socket.on('data', (data) => {
      buffer += data.toString('utf8');
      const lines = buffer.split('\r\n');
      const last = lines[lines.length - 1] === '' ? lines[lines.length - 2] : lines[lines.length - 1];
      if (!last || !/^\d{3}/.test(last)) return;
      const code = parseInt(last.slice(0, 3), 10);
      buffer = '';
      if (code >= 400) {
        fail(new Error('smtp refused: ' + code));
        return;
      }
      if (stage === 0) {
        socket.write('HELO linewright.test\r\n');
        stage = 1;
      } else if (stage === 1) {
        socket.write(`MAIL FROM:<${config.smtp.from.replace(/^.*</, '').replace(/>.*$/, '')}>\r\n`);
        stage = 2;
      } else if (stage === 2) {
        socket.write(`RCPT TO:<${mail.to}>\r\n`);
        stage = 3;
      } else if (stage === 3) {
        socket.write('DATA\r\n');
        stage = 4;
      } else if (stage === 4 && !mimeSent) {
        mimeSent = true;
        socket.write(buildMime(mail));
      } else if (stage === 4) {
        socket.write('QUIT\r\n');
        socket.end();
        resolve();
      }
    });
  });
}
