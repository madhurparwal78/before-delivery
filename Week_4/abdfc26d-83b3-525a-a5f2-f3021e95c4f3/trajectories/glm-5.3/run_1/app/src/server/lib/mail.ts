import net from 'node:net';
import { config } from '../../config.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  attachments: { filename: string; contentType: string; base64: string }[];
}

const encodeHeader = (value: string): string => value.replace(/([^\x20-\x7e])/g, (_, ch) => `=?UTF-8?B?${Buffer.from(ch, 'utf8').toString('base64')}?=`);

function render(msg: MailMessage): string {
  const boundary = `----phosphene${Date.now()}`;
  const lines = [
    `From: ${config.mailFrom}`,
    `To: ${msg.to}`,
    `Subject: ${encodeHeader(msg.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(msg.text, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n')
  ];
  for (const att of msg.attachments) {
    lines.push(
      `--${boundary}`,
      `Content-Type: ${att.contentType}; name="${att.filename}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${att.filename}"`,
      '',
      att.base64.replace(/(.{76})/g, '$1\r\n')
    );
  }
  lines.push(`--${boundary}--`, '');
  return lines.join('\r\n');
}

export async function smtpSend(msg: MailMessage, host = config.smtpHost, port = config.smtpPort): Promise<void> {
  const rendered = render(msg);
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port, timeout: 10_000 });
    let buffer = '';
    let step = 0;
    const fail = (err: Error) => { socket.destroy(); reject(err); };
    socket.on('timeout', () => fail(new Error('smtp_timeout')));
    socket.on('error', (err) => fail(err));
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\r\n');
      const code = Number.parseInt(lines[lines.length - 1].slice(0, 3), 10);
      if (code >= 500) return fail(new Error(`smtp_rejected ${code}`));
      if (step === 0) { socket.write(`HELO phosphene.local\r\n`); step = 1; buffer = ''; return; }
      if (step === 1) { socket.write(`MAIL FROM:<${envelopeFrom()}>\r\n`); step = 2; buffer = ''; return; }
      if (step === 2) { socket.write(`RCPT TO:<${msg.to}>\r\n`); step = 3; buffer = ''; return; }
      if (step === 3) { socket.write('DATA\r\n'); step = 4; buffer = ''; return; }
      if (step === 4) {
        const dotStuff = rendered.replace(/\r\n\./g, '\r\n..');
        socket.write(`${dotStuff}\r\n.\r\n`);
        step = 5;
        buffer = '';
        return;
      }
      if (step === 5) { socket.write('QUIT\r\n'); socket.end(); resolve(); }
    });
    socket.on('close', () => {
      if (step < 6) resolve();
    });
  });
}

function envelopeFrom(): string {
  const match = config.mailFrom.match(/<([^>]+)>/);
  return match?.[1] ?? 'studio@brightmoss.example';
}

export async function mailProbe(host = config.smtpHost, port = config.smtpPort): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port, timeout: 5_000 });
    socket.on('connect', () => { socket.destroy(); resolve(true); });
    socket.on('error', () => resolve(false));
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
  });
}
