import { connect } from 'node:net';
import { randomUUID } from 'node:crypto';
import { config } from './config';

const TIMEOUT_MS = 5000;

/** Plain SMTP to Mailpit. Resolves only when the server accepted the message after DATA; rejects on any refusal. */
export function sendMail(to: string, subject: string, body: string): Promise<void> {
  const message = [
    `From: ${config.smtp.from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@pennywasher.example>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    body.replace(/^\./gm, '..'),
    '.',
    '',
  ].join('\r\n');
  const exchange = [
    { send: 'EHLO pennywasher.example\r\n', expect: 250 },
    { send: `MAIL FROM:<${config.smtp.fromAddress}>\r\n`, expect: 250 },
    { send: `RCPT TO:<${to}>\r\n`, expect: 250 },
    { send: 'DATA\r\n', expect: 354 },
    { send: message, expect: 250 },
  ];
  return new Promise((resolve, reject) => {
    const socket = connect(config.smtp.port, config.smtp.host);
    socket.setTimeout(TIMEOUT_MS, () => socket.destroy(new Error('SMTP timeout')));
    let pending = '';
    let greeted = false;
    let done = false;
    let step = 0;
    socket.on('data', (chunk) => {
      if (done) return;
      pending += chunk.toString();
      const lines = pending.split('\r\n');
      const last = lines[lines.length - 2];
      if (last === undefined || !/^\d{3} /.test(last)) return;
      const code = Number(last.slice(0, 3));
      pending = '';
      if (!greeted) {
        if (code !== 220) return void socket.destroy(new Error(`SMTP ${code}`));
        greeted = true;
        socket.write(exchange[0]!.send);
        return;
      }
      if (code !== exchange[step]!.expect) return void socket.destroy(new Error(`SMTP ${code}`));
      step++;
      if (step === exchange.length) {
        done = true;
        socket.end('QUIT\r\n');
        resolve();
        return;
      }
      socket.write(exchange[step]!.send);
    });
    socket.on('error', reject);
    socket.on('close', () => {
      if (!done) reject(new Error('SMTP closed before the message was accepted'));
    });
  });
}
