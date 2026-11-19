import net from 'node:net';
import { settings } from './settings.js';

export type PendingMail = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  clinicId: string;
  kind: string;
  vaccinationId?: string;
  petToken?: string;
};

// One small SMTP client. Delivery failures are retried every 5 seconds and
// never fail the request that caused them.
const outbox: PendingMail[] = [];

export function enqueueMail(mail: PendingMail): void {
  outbox.push(mail);
}

const encodeWord = (s: string): string => {
  // RFC 2047 encoded-word for any header value with non-ASCII text
  if (/^[\x20-\x7e]*$/.test(s)) return s;
  return `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;
};

function extractAddress(from: string): string {
  const m = from.match(/<([^>]+)>/);
  return m ? m[1] : from;
}

function smtpSend(mail: PendingMail): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: settings.smtpHost, port: settings.smtpPort });
    socket.setTimeout(4000);
    let stage = 0;
    let buffer = '';
    const fail = (err: Error) => {
      socket.destroy();
      reject(err);
    };
    socket.on('data', (d: Buffer) => {
      buffer += d.toString('utf8');
      if (!/\r\n$/.test(buffer)) return;
      const code = Number(buffer.slice(0, 3));
      buffer = '';
      if (code >= 500) return fail(new Error(`smtp ${code}`));
      stage += 1;
      if (stage === 1) {
        socket.write('EHLO roundbook\r\n');
      } else if (stage === 2) {
        socket.write(`MAIL FROM:<${extractAddress(settings.mailFrom)}>\r\n`);
      } else if (stage === 3) {
        socket.write(`RCPT TO:<${mail.to}>\r\n`);
      } else if (stage === 4) {
        socket.write('DATA\r\n');
      } else if (stage === 5) {
        const body = [
          `From: ${settings.mailFrom}`,
          `To: ${mail.to}`,
          `Subject: ${encodeWord(mail.subject)}`,
          'MIME-Version: 1.0',
          'Content-Type: text/plain; charset=UTF-8',
          '',
          mail.text,
        ].join('\r\n');
        socket.write(body.replace(/\r\n\.(\r|$)/g, '\r\n..$1') + '\r\n.\r\n');
        socket.write('QUIT\r\n');
        socket.end();
        resolve();
        return;
      }
    });
    socket.on('error', fail);
    socket.on('timeout', () => fail(new Error('smtp timeout')));
  });
}

export async function flushMail(): Promise<void> {
  const batch = outbox.splice(0, outbox.length);
  for (const mail of batch) {
    try {
      await smtpSend(mail);
      await markMailSent(mail);
    } catch {
      outbox.push(mail); // retry on the next flush
    }
  }
}

type SentCallback = (mail: PendingMail) => Promise<void> | void;
let sentCallback: SentCallback | null = null;
export function onMailSent(cb: SentCallback): void {
  sentCallback = cb;
}
async function markMailSent(mail: PendingMail): Promise<void> {
  if (sentCallback) await sentCallback(mail);
}
