import * as net from 'node:net';
import { config } from '../config';

export interface Message {
  to: string;
  subject: string;
  text: string;
}

function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function addressOf(from: string): string {
  const match = /<([^>]+)>/.exec(from);
  return match ? match[1] : from.trim();
}

function body(message: Message): string {
  const headers = [
    `From: ${config.mail.from}`,
    `To: ${message.to}`,
    `Subject: ${encodeHeader(message.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
  ];
  const encoded = Buffer.from(message.text, 'utf8')
    .toString('base64')
    .replace(/(.{76})/g, '$1\r\n');
  return `${headers.join('\r\n')}\r\n\r\n${encoded}\r\n`;
}

/** A minimal SMTP client: Mailpit needs only the plain envelope exchange. */
export function sendMail(message: Message): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: config.mail.host, port: config.mail.port });
    const steps = [
      `EHLO farshore\r\n`,
      `MAIL FROM:<${addressOf(config.mail.from)}>\r\n`,
      `RCPT TO:<${message.to}>\r\n`,
      `DATA\r\n`,
      `${body(message).replace(/\r\n\./g, '\r\n..')}\r\n.\r\n`,
      `QUIT\r\n`,
    ];
    let step = -1;
    let buffer = '';
    socket.setTimeout(10000);
    const fail = (error: Error): void => {
      socket.destroy();
      reject(error);
    };
    socket.on('error', fail);
    socket.on('timeout', () => fail(new Error('smtp timeout')));
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      if (!/\r\n$/.test(buffer)) return;
      const lines = buffer.trimEnd().split('\r\n');
      const last = lines[lines.length - 1];
      buffer = '';
      if (/^[45]/.test(last)) {
        fail(new Error(`smtp refused: ${last}`));
        return;
      }
      step += 1;
      if (step >= steps.length) {
        socket.end();
        resolve();
        return;
      }
      socket.write(steps[step]);
    });
    socket.on('close', () => {
      if (step >= steps.length - 1) resolve();
    });
  });
}
