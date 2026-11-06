import { connect } from 'node:net';
import type { Config } from './config.js';

export class MailUnavailable extends Error {}

export interface Mail {
  to: string;
  subject: string;
  body: string;
}

export async function sendMail(config: Config, mail: Mail): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = connect({ host: config.smtp.host, port: config.smtp.port });
    let buffer = '';
    let step = -1;
    const fail = (err: Error) => {
      socket.destroy();
      reject(new MailUnavailable(err.message));
    };
    socket.setTimeout(15000, () => fail(new Error('timeout')));
    socket.on('error', fail);
    const steps: Array<() => void> = [
      () => socket.write('EHLO tidewright\r\n'),
      () => {
        const from = /<(.*)>/.exec(config.smtp.from)?.[1] ?? config.smtp.from;
        socket.write(`MAIL FROM:<${from}>\r\n`);
      },
      () => socket.write(`RCPT TO:<${mail.to}>\r\n`),
      () => socket.write('DATA\r\n'),
      () => {
        const payload = [
          `From: ${config.smtp.from}`,
          `To: <${mail.to}>`,
          `Subject: ${mail.subject}`,
          'MIME-Version: 1.0',
          'Content-Type: text/plain; charset=utf-8',
          'Content-Transfer-Encoding: 8bit',
          '',
          mail.body,
        ].join('\n');
        socket.write(payload.replace(/\r?\n/g, '\r\n') + '\r\n.\r\n');
      },
      () => {
        socket.write('QUIT\r\n');
        socket.end();
      },
    ];
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      // Wait for a complete reply: the final line of a multiline reply has a space.
      const reply = buffer.replace(/\r\n$/, '');
      const lines = reply.split('\r\n');
      const last = lines[lines.length - 1];
      if (!/^\d{3} /.test(last)) return;
      const code = Number(last.slice(0, 3));
      buffer = '';
      if (code >= 500) {
        fail(new Error(`SMTP ${code}`));
        return;
      }
      step += 1;
      if (step >= steps.length) {
        socket.destroy();
        resolve();
        return;
      }
      steps[step]();
    });
  });
}
