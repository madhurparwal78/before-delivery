import { createConnection, type Socket } from 'net';
import { config } from './config';

/**
 * A minimal SMTP client for the outbound mail sink. Plain SMTP with STARTTLS
 * skipped: the sink accepts unauthenticated plain-text submission on the LAN.
 */
const sendViaSocket = (socket: Socket, expect: number): Promise<string[]> =>
  new Promise((resolve, reject) => {
    let buffer = '';
    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\r\n');
      while (lines.length > 1) {
        const line = lines.shift() as string;
        if (/^\d{3}-/.test(line)) {
          buffer = lines.join('\r\n');
          continue;
        }
        buffer = lines.join('\r\n');
        socket.removeListener('data', onData);
        if (line.startsWith(String(expect))) resolve([line, buffer]);
        else reject(new Error(`smtp expected ${expect}, got ${line}`));
        return;
      }
      buffer = lines.join('\r\n');
    };
    socket.on('data', onData);
    socket.on('error', reject);
  });

export interface MailMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
}

export const sendMail = (message: MailMessage): Promise<void> =>
  new Promise((resolve, reject) => {
    const socket = createConnection({ host: config.smtp.host, port: config.smtp.port });
    socket.setTimeout(8000);
    let settled = false;
    const fail = (e: Error): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(e);
    };
    socket.on('timeout', () => fail(new Error('smtp timeout')));
    socket.on('error', fail);
    const step = async (line: string, expect: number): Promise<string[]> => {
      socket.write(`${line}\r\n`);
      return sendViaSocket(socket, expect);
    };
    socket.on('connect', async () => {
      try {
        await sendViaSocket(socket, 220);
        await step('HELO cairn', 250);
        await step(`MAIL FROM:<${envelopeAddress(message.from)}>`, 250);
        await step(`RCPT TO:<${message.to}>`, 250);
        await step('DATA', 354);
        const body = [
          `From: ${message.from}`,
          `To: ${message.to}`,
          `Subject: ${message.subject}`,
          'MIME-Version: 1.0',
          'Content-Type: multipart/alternative; boundary="cairn-mail"',
          '',
          '--cairn-mail',
          'Content-Type: text/plain; charset=utf-8',
          '',
          message.text,
          '--cairn-mail',
          'Content-Type: text/html; charset=utf-8',
          '',
          message.html,
          '--cairn-mail--',
          '.',
        ].join('\r\n');
        socket.write(`${body}\r\n`);
        await sendViaSocket(socket, 250);
        await step('QUIT', 221);
        socket.end();
        if (!settled) {
          settled = true;
          resolve();
        }
      } catch (e) {
        fail(e as Error);
      }
    });
  });

const envelopeAddress = (from: string): string => {
  const m = /<([^>]+)>/.exec(from);
  return m ? m[1] : from;
};
