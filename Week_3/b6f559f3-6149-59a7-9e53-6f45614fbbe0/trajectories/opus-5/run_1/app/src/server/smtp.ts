import { createConnection } from 'node:net';
import type { Socket } from 'node:net';
import { config } from './config';

export interface Mail {
  to: string;
  subject: string;
  body: string;
}

function addressOf(from: string): string {
  const match = /<([^>]+)>/.exec(from);
  return match ? match[1] : from.trim();
}

function encodeHeader(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function message(mail: Mail): string {
  const lines = [
    `From: ${config.smtp.from}`,
    `To: ${mail.to}`,
    `Subject: ${encodeHeader(mail.subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    ...mail.body.split('\n').map((line) => (line.startsWith('.') ? `.${line}` : line)),
  ];
  return `${lines.join('\r\n')}\r\n.\r\n`;
}

/** A minimal SMTP client for the local mail service. */
export async function sendMail(mail: Mail): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket: Socket = createConnection({
      host: config.smtp.host,
      port: config.smtp.port,
    });
    socket.setTimeout(5000);
    let buffer = '';
    const steps: { expect: number; send: string | null }[] = [
      { expect: 220, send: `EHLO halation-studio\r\n` },
      { expect: 250, send: `MAIL FROM:<${addressOf(config.smtp.from)}>\r\n` },
      { expect: 250, send: `RCPT TO:<${mail.to}>\r\n` },
      { expect: 250, send: 'DATA\r\n' },
      { expect: 354, send: message(mail) },
      { expect: 250, send: 'QUIT\r\n' },
    ];
    let step = 0;
    const fail = (error: Error): void => {
      socket.destroy();
      reject(error);
    };
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      for (;;) {
        const match = /^(\d{3})(?: |-)(.*)\r\n/m.exec(buffer);
        if (!match) return;
        const lineEnd = buffer.indexOf('\r\n') + 2;
        const line = buffer.slice(0, lineEnd);
        buffer = buffer.slice(lineEnd);
        if (line[3] === '-') continue;
        const code = Number(line.slice(0, 3));
        const current = steps[step];
        if (!current) return;
        if (code !== current.expect) {
          fail(new Error(`SMTP step ${step} expected ${current.expect} but got ${code}`));
          return;
        }
        step += 1;
        if (current.send !== null) socket.write(current.send);
        if (step >= steps.length) {
          socket.end();
          resolve();
          return;
        }
      }
    });
    socket.on('timeout', () => fail(new Error('SMTP timeout')));
    socket.on('error', (error) => fail(error));
    socket.on('close', () => {
      if (step < steps.length) fail(new Error('SMTP connection closed early'));
    });
  });
}
