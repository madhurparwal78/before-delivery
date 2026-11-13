import { createConnection } from 'node:net';
import { randomUUID } from 'node:crypto';
import { config, SERVICE_PING_MS } from '../config.js';

const CONNECT_TIMEOUT_MS = 5_000;

export class MailUnavailable extends Error {}

interface Mail { to: string; subject: string; text: string }

const addressOf = (header: string): string => /<([^>]+)>/.exec(header)?.[1] ?? header.trim();

const encodeHeader = (value: string): string => (/^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value).toString('base64')}?=`);

const wrap = (base64: string): string => base64.replace(/.{1,76}/g, '$&\r\n').trimEnd();

/** One SMTP conversation: EHLO, MAIL FROM, RCPT TO, DATA, QUIT. The mail counts as sent once the server accepts DATA. */
export const sendMail = (mail: Mail): Promise<void> =>
  new Promise((resolve, reject) => {
    const socket = createConnection({ host: config.smtp.host, port: config.smtp.port });
    socket.setTimeout(CONNECT_TIMEOUT_MS);
    let buffer = '';
    let waiting: ((code: number) => void) | null = null;
    const fail = (): void => {
      socket.destroy();
      reject(new MailUnavailable('the mail server did not accept the message'));
    };
    socket.on('error', fail);
    socket.on('timeout', fail);
    socket.on('close', () => { if (waiting) fail(); });
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\r\n');
      const last = lines.filter((line) => line !== '').pop();
      if (last !== undefined && /^\d{3} /.test(last) && buffer.endsWith('\r\n') && waiting) {
        const code = Number(last.slice(0, 3));
        const callback = waiting;
        waiting = null;
        buffer = '';
        callback(code);
      }
    });
    const reply = (): Promise<number> => new Promise((done) => { waiting = done; });
    const command = async (line: string, expected: number): Promise<void> => {
      socket.write(`${line}\r\n`);
      if ((await reply()) !== expected) fail();
    };
    const body = [
      `From: ${config.mailFrom}`, `To: ${mail.to}`, `Subject: ${encodeHeader(mail.subject)}`, `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${randomUUID()}@overcall>`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: base64', '', wrap(Buffer.from(mail.text, 'utf8').toString('base64')),
    ].join('\r\n');
    (async () => {
      if ((await reply()) !== 220) return fail();
      await command('EHLO overcall', 250);
      await command(`MAIL FROM:<${addressOf(config.mailFrom)}>`, 250);
      await command(`RCPT TO:<${addressOf(mail.to)}>`, 250);
      await command('DATA', 354);
      await command(`${body}\r\n.`, 250);
      socket.write('QUIT\r\n');
      socket.end();
      resolve();
    })().catch(fail);
  });

export const pingMail = (): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = createConnection({ host: config.smtp.host, port: config.smtp.port });
    socket.setTimeout(SERVICE_PING_MS);
    socket.once('data', (chunk: Buffer) => { socket.destroy(); resolve(chunk.toString('utf8').startsWith('220')); });
    socket.once('error', () => resolve(false));
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
  });
