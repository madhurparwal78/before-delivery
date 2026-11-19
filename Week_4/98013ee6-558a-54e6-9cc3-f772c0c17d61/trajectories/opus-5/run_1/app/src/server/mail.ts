import { createConnection } from 'node:net';
import { env } from './env.js';

export interface Mail {
  to: string;
  subject: string;
  body: string;
}

function envelopeAddress(value: string): string {
  const match = /<([^>]+)>/.exec(value);
  return match ? match[1] : value.trim();
}

function encodeHeader(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function message(mail: Mail): string {
  const body = Buffer.from(mail.body, 'utf8').toString('base64');
  const wrapped = body.replace(/(.{76})/g, '$1\r\n');
  return [
    `From: ${env.smtp.from}`,
    `To: ${mail.to}`,
    `Subject: ${encodeHeader(mail.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrapped,
  ].join('\r\n');
}

function talk(mail: Mail): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: env.smtp.host, port: env.smtp.port });
    socket.setTimeout(10000);
    const steps = [
      `EHLO ${'mothlight'}`,
      `MAIL FROM:<${envelopeAddress(env.smtp.from)}>`,
      `RCPT TO:<${envelopeAddress(mail.to)}>`,
      'DATA',
    ];
    let step = -1;
    let buffer = '';
    let sentBody = false;

    const fail = (error: Error): void => {
      socket.destroy();
      reject(error);
    };

    socket.on('timeout', () => fail(new Error('smtp timeout')));
    socket.on('error', fail);
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      let index = buffer.indexOf('\r\n');
      while (index >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        if (line.length >= 4 && line[3] === '-') {
          index = buffer.indexOf('\r\n');
          continue;
        }
        const code = Number.parseInt(line.slice(0, 3), 10);
        if (code >= 400) {
          fail(new Error(`smtp error: ${line}`));
          return;
        }
        if (sentBody) {
          socket.write('QUIT\r\n');
          socket.end();
          resolve();
          return;
        }
        step += 1;
        if (step < steps.length) {
          socket.write(`${steps[step]}\r\n`);
        } else {
          sentBody = true;
          socket.write(`${message(mail)}\r\n.\r\n`);
        }
        index = buffer.indexOf('\r\n');
      }
    });
  });
}

/** Mail is handed over in the background: no reply ever waits for it. */
export function sendMail(mail: Mail): void {
  void talk(mail).catch(() => undefined);
}

export const mails = {
  signupCode: (email: string, code: string): Mail => ({
    to: email,
    subject: `Your Mothlight code is ${code}`,
    body: `Your Mothlight code is ${code}.\n\nEnter ${code} to confirm your account.\n`,
  }),
  existingAccount: (email: string): Mail => ({
    to: email,
    subject: 'You already have a Mothlight account',
    body: `You already have a Mothlight account.\n\nSign in here: ${env.publicUrl}/signin\n`,
  }),
  invite: (email: string, inviter: string, board: string, role: 'editor' | 'viewer', token: string): Mail => ({
    to: email,
    subject: `${inviter} invited you to ${board}`,
    body: `${inviter} invited you to ${board} on Mothlight.\n\nRole: ${role === 'editor' ? 'Editor' : 'Viewer'}\n\n${env.publicUrl}/invites/${token}\n`,
  }),
  joined: (email: string, name: string, board: string): Mail => ({
    to: email,
    subject: `${name} joined ${board}`,
    body: `${name} joined ${board}.\n`,
  }),
};
