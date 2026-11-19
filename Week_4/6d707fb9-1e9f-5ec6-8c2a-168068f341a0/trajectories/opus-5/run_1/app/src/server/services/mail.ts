import { createConnection } from 'node:net';
import { config } from '../config';

export class MailNotAccepted extends Error {}

function encodeHeader(text: string): string {
  if (/^[\x20-\x7e]*$/.test(text)) return text;
  return `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`;
}

function dotStuff(body: string): string {
  return body
    .split('\n')
    .map((line) => (line.startsWith('.') ? `.${line}` : line))
    .join('\r\n');
}

function recipientAddress(recipient: string): string {
  const match = /<([^>]+)>/.exec(recipient);
  return match ? (match[1] as string) : recipient.trim();
}

/** Every mail goes over SMTP to the configured host. */
export async function sendMail(message: {
  to: string;
  subject: string;
  body: string;
}): Promise<void> {
  const fromAddress = recipientAddress(config.smtp.from);
  const toAddress = recipientAddress(message.to);
  const headers = [
    `From: ${config.smtp.from}`,
    `To: ${message.to}`,
    `Subject: ${encodeHeader(message.subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    `Date: ${new Date().toUTCString()}`,
  ].join('\r\n');
  const payload = `${headers}\r\n\r\n${dotStuff(message.body)}\r\n`;

  await new Promise<void>((resolve, reject) => {
    const socket = createConnection({ host: config.smtp.host, port: config.smtp.port });
    socket.setTimeout(5000);
    const steps = [
      `EHLO fio-contado-desk\r\n`,
      `MAIL FROM:<${fromAddress}>\r\n`,
      `RCPT TO:<${toAddress}>\r\n`,
      `DATA\r\n`,
      `${payload}.\r\n`,
      `QUIT\r\n`,
    ];
    let step = -1;
    let buffer = '';
    const fail = (why: string): void => {
      socket.destroy();
      reject(new MailNotAccepted(why));
    };
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      while (true) {
        const lines = buffer.split('\r\n');
        const complete = lines.filter((line) => /^\d{3} /.test(line));
        if (complete.length === 0) return;
        const reply = complete[complete.length - 1] as string;
        buffer = '';
        const code = Number(reply.slice(0, 3));
        if (code >= 400) {
          fail(`the mail server answered ${reply}`);
          return;
        }
        step += 1;
        const next = steps[step];
        if (next === undefined) {
          socket.end();
          resolve();
          return;
        }
        socket.write(next);
        if (step === steps.length - 1) {
          socket.end();
          resolve();
          return;
        }
        return;
      }
    });
    socket.on('timeout', () => fail('the mail server timed out'));
    socket.on('error', (problemFound) => fail(problemFound.message));
  });
}
