import { createConnection } from 'node:net';
import { config } from './config.js';

export class MailDown extends Error {}

interface Envelope {
  to: string;
  subject: string;
  body: string;
}

function headerValue(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function fromAddress(): string {
  const match = /<([^>]+)>/.exec(config.smtp.from);
  return match === null ? config.smtp.from.trim() : match[1]!;
}

/** Sends one message over SMTP. Rejects with MailDown when the server cannot be reached. */
function transmit(envelope: Envelope): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: config.smtp.host, port: config.smtp.port });
    socket.setTimeout(8000);
    const dot = '\r\n.\r\n';
    const message =
      [
        `From: ${config.smtp.from}`,
        `To: ${envelope.to}`,
        `Subject: ${headerValue(envelope.subject)}`,
        `Date: ${new Date().toUTCString()}`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=utf-8',
      ].join('\r\n') +
      '\r\n\r\n' +
      envelope.body.replaceAll('\r\n', '\n').replaceAll('\n', '\r\n').replaceAll('\r\n.', '\r\n..');
    const steps = [
      `EHLO wringbench\r\n`,
      `MAIL FROM:<${fromAddress()}>\r\n`,
      `RCPT TO:<${envelope.to}>\r\n`,
      `DATA\r\n`,
      message + dot,
      `QUIT\r\n`,
    ];
    let stage = -1;
    let buffer = '';
    const fail = (reason: string): void => {
      socket.destroy();
      reject(new MailDown(reason));
    };
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      while (buffer.includes('\r\n')) {
        const line = buffer.slice(0, buffer.indexOf('\r\n'));
        buffer = buffer.slice(buffer.indexOf('\r\n') + 2);
        if (/^\d{3}-/.test(line)) continue;
        const code = Number.parseInt(line.slice(0, 3), 10);
        if (code >= 400) {
          fail(`SMTP said: ${line}`);
          return;
        }
        stage += 1;
        const next = steps[stage];
        if (next === undefined) {
          socket.end();
          resolve();
          return;
        }
        socket.write(next);
      }
    });
    socket.on('timeout', () => fail('SMTP timed out'));
    socket.on('error', (cause) => fail(cause.message));
    socket.on('close', () => {
      if (stage < steps.length - 1) reject(new MailDown('SMTP closed early'));
    });
  });
}

export async function sendVerificationEmail(to: string, displayName: string, token: string): Promise<void> {
  const link = `${config.publicUrl}/verify/${token}`;
  await transmit({
    to,
    subject: 'Confirm your Wringbench account',
    body: `Hello ${displayName},\n\nConfirm your Wringbench account by opening this link:\n\n${link}\n\nIf you did not sign up, you can ignore this message.\n`,
  });
}

export async function sendInviteEmail(
  to: string,
  teamName: string,
  inviterName: string,
  token: string,
): Promise<void> {
  const link = `${config.publicUrl}/invite/${token}`;
  await transmit({
    to,
    subject: `Join ${teamName} on Wringbench`,
    body: `${inviterName} invited you to join ${teamName} on Wringbench.\n\nJoin the team by opening this link:\n\n${link}\n`,
  });
}
