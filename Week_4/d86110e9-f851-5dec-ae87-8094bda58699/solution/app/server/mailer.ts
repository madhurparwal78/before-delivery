import net from 'node:net';
import { config } from './config.js';

export class MailUnavailable extends Error {}

interface Mail {
  to: string;
  subject: string;
  text: string;
  headers?: Record<string, string>;
}

const TIMEOUT_MS = 4000;

function fromAddress(): string {
  const open = config.mailFrom.indexOf('<');
  return open === -1 ? config.mailFrom.trim() : config.mailFrom.slice(open + 1, config.mailFrom.indexOf('>'));
}

function headerText(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function fromHeader(): string {
  const open = config.mailFrom.indexOf('<');
  if (open === -1) return config.mailFrom.trim();
  const name = config.mailFrom.slice(0, open).trim();
  return name === '' ? `<${fromAddress()}>` : `${headerText(name)} <${fromAddress()}>`;
}

function message(mail: Mail): string {
  const lines = [
    `From: ${fromHeader()}`,
    `To: ${mail.to}`,
    `Subject: ${headerText(mail.subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    ...Object.entries(mail.headers ?? {}).map(([name, value]) => `${name}: ${headerText(value)}`),
    '',
    ...(Buffer.from(mail.text, 'utf8').toString('base64').match(/.{1,76}/g) ?? []),
  ];
  return lines.join('\r\n');
}

/** One SMTP conversation: every command must be answered with the expected class of reply. */
function converse(socket: net.Socket): (command: string | null, expect: number) => Promise<void> {
  let buffer = '';
  const waiting: Array<(reply: string) => void> = [];
  socket.setEncoding('utf8');
  socket.on('data', (chunk: string) => {
    buffer += chunk;
    for (;;) {
      const lines = buffer.split('\r\n');
      const last = lines.findIndex((line) => /^\d{3} /.test(line));
      if (last === -1) return;
      const reply = lines.slice(0, last + 1).join('\r\n');
      buffer = lines.slice(last + 1).join('\r\n');
      waiting.shift()?.(reply);
    }
  });
  return (command, expect) =>
    new Promise<void>((resolve, reject) => {
      waiting.push((reply) => (Number(reply.slice(0, 3)) === expect ? resolve() : reject(new MailUnavailable(reply))));
      if (command !== null) socket.write(`${command}\r\n`);
    });
}

export async function sendMail(mail: Mail): Promise<void> {
  const socket = net.connect({ host: config.smtp.host, port: config.smtp.port });
  socket.setTimeout(TIMEOUT_MS);
  const failure = new Promise<never>((_resolve, reject) => {
    socket.on('error', (error) => reject(new MailUnavailable(error.message)));
    socket.on('timeout', () => reject(new MailUnavailable('SMTP timed out')));
    socket.on('close', () => reject(new MailUnavailable('SMTP closed')));
  });
  failure.catch(() => undefined);
  const say = converse(socket);
  const dialogue = async (): Promise<void> => {
    await say(null, 220);
    await say('EHLO switchyard', 250);
    await say(`MAIL FROM:<${fromAddress()}>`, 250);
    await say(`RCPT TO:<${mail.to}>`, 250);
    await say('DATA', 354);
    await say(`${message(mail).replace(/^\./gm, '..')}\r\n.`, 250);
    await say('QUIT', 221);
  };
  try {
    await Promise.race([dialogue(), failure]);
  } finally {
    socket.destroy();
  }
}

/** True when the mail server answers its greeting. */
export async function mailReachable(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const socket = net.connect({ host: config.smtp.host, port: config.smtp.port });
    socket.setTimeout(TIMEOUT_MS);
    socket.once('data', () => {
      socket.destroy();
      resolve(true);
    });
    for (const event of ['error', 'timeout', 'close'] as const) {
      socket.once(event, () => {
        socket.destroy();
        resolve(false);
      });
    }
  });
}
