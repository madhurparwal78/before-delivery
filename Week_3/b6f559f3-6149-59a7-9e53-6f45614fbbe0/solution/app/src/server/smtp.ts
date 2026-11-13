/** A minimal SMTP client for Mailpit: one plain-text message per connection. */
import { connect } from 'node:net';

interface Mail {
  from: string;
  to: string;
  subject: string;
  text: string;
}

interface SmtpSettings {
  host: string;
  port: number;
}

const TIMEOUT_MS = 8000;

const address = (value: string): string => /<([^>]+)>/.exec(value)?.[1] ?? value;

/** Encodes a header value as RFC 2047 when it holds anything beyond printable ASCII. */
const header = (value: string): string => (/^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value).toString('base64')}?=`);

function compose(mail: Mail): string {
  const body = mail.text.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
  return [
    `From: ${mail.from}`,
    `To: ${mail.to}`,
    `Subject: ${header(mail.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(body).toString('base64').replace(/(.{76})/g, '$1\r\n'),
    '',
  ].join('\r\n');
}

/** Sends one mail. Rejects when the server cannot be reached or refuses the message. */
export function sendMail(settings: SmtpSettings, mail: Mail, timeoutMs = TIMEOUT_MS): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: settings.host, port: settings.port });
    socket.setTimeout(timeoutMs);
    const steps = [
      { send: 'EHLO halation.studio', expect: 250 },
      { send: `MAIL FROM:<${address(mail.from)}>`, expect: 250 },
      { send: `RCPT TO:<${address(mail.to)}>`, expect: 250 },
      { send: 'DATA', expect: 354 },
      { send: `${compose(mail)}\r\n.`, expect: 250 },
      { send: 'QUIT', expect: 221 },
    ];
    let index = -1;
    let buffer = '';
    let finished = false;
    const done = (error?: Error): void => {
      if (finished) return;
      finished = true;
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };
    socket.on('timeout', () => done(new Error('SMTP timeout')));
    socket.on('error', (error) => done(error));
    socket.on('close', () => done(new Error('SMTP connection closed early')));
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      for (;;) {
        const end = buffer.indexOf('\r\n');
        if (end < 0) return;
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (/^\d{3}-/.test(line)) continue;
        const code = Number(line.slice(0, 3));
        const expected = index < 0 ? 220 : (steps[index] as (typeof steps)[number]).expect;
        if (code !== expected) return done(new Error(`SMTP ${line}`));
        index += 1;
        const next = steps[index];
        if (!next) return done();
        socket.write(`${next.send}\r\n`);
      }
    });
  });
}
