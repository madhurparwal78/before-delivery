import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { config } from './config.ts';

// Mailpit receives every email (brief: Services). A minimal SMTP client: one message per connection.

const TIMEOUT_MS = 4_000;
const FINAL_LINE = /^\d{3}( |$)/;

interface Reply { code: number; text: string }
interface Session { send: (line: string) => Promise<Reply>; close: () => void }
interface Waiter { resolve: (reply: Reply) => void; reject: (error: Error) => void }

function open(): Promise<Session> {
  return new Promise((resolveSession, rejectSession) => {
    const socket = net.connect({ host: config.smtp.host, port: config.smtp.port });
    socket.setTimeout(TIMEOUT_MS, () => socket.destroy(new Error('SMTP timeout')));
    let buffer = '';
    let waiter: Waiter | null = null;
    let failure: Error | null = null;

    const flush = (): void => {
      if (!waiter) return;
      const lines = buffer.split('\r\n');
      const last = lines.findIndex((line, index) => index < lines.length - 1 && FINAL_LINE.test(line));
      if (last < 0) return;
      const reply = { code: Number((lines[last] ?? '').slice(0, 3)), text: lines.slice(0, last + 1).join('\n') };
      buffer = lines.slice(last + 1).join('\r\n');
      const done = waiter;
      waiter = null;
      done.resolve(reply);
    };
    const next = (): Promise<Reply> => new Promise((resolve, reject) => {
      if (failure) return reject(failure);
      waiter = { resolve, reject };
      flush();
    });
    const fail = (error: Error): void => {
      failure = error;
      rejectSession(error);
      waiter?.reject(error);
      waiter = null;
    };

    socket.on('data', (chunk) => { buffer += chunk.toString('utf8'); flush(); });
    socket.on('error', fail);
    socket.on('close', () => fail(new Error('SMTP closed')));
    socket.once('connect', () => {
      next().then((greeting) => {
        if (greeting.code !== 220) throw new Error(`SMTP greeting ${greeting.code}`);
        resolveSession({
          send: (line) => { socket.write(`${line}\r\n`); return next(); },
          close: () => socket.end(),
        });
      }).catch(fail);
    });
  });
}

/** Connects, says hello and quits: whether Mailpit answers. */
export async function checkMailpit(): Promise<boolean> {
  try {
    const smtp = await open();
    const hello = await smtp.send('EHLO nightform');
    smtp.close();
    return hello.code === 250;
  } catch {
    return false;
  }
}

const bareAddress = (from: string): string => (from.includes('<') ? from.slice(from.indexOf('<') + 1, from.indexOf('>')) : from.trim());
const headerText = (text: string): string => (/^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`);

export async function sendMail(to: string, subject: string, body: string): Promise<void> {
  const smtp = await open();
  try {
    const expect = async (line: string, code: number): Promise<void> => {
      const reply = await smtp.send(line);
      if (reply.code !== code) throw new Error(`SMTP ${reply.code} for ${line.split(' ')[0] ?? ''}`);
    };
    await expect('EHLO nightform', 250);
    await expect(`MAIL FROM:<${bareAddress(config.smtp.from)}>`, 250);
    await expect(`RCPT TO:<${to}>`, 250);
    await expect('DATA', 354);
    const encoded = (Buffer.from(body, 'utf8').toString('base64').match(/.{1,76}/g) ?? []).join('\r\n');
    const message = [
      `From: ${config.smtp.from}`,
      `To: <${to}>`,
      `Subject: ${headerText(subject)}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${randomUUID()}@nightform>`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      encoded,
    ].join('\r\n');
    await expect(`${message}\r\n.`, 250);
    await smtp.send('QUIT').catch(() => undefined);
  } finally {
    smtp.close();
  }
}
