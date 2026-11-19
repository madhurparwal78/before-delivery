import { createConnection } from 'node:net';
import { config } from './config.js';

interface Mail {
  to: string;
  subject: string;
  body: string;
}

function addressOnly(from: string): string {
  const match = /<([^>]+)>/.exec(from);
  return match ? match[1] : from;
}

/** Minimal SMTP submission: mailpit accepts plain, unauthenticated sessions. */
export async function sendMail(mail: Mail): Promise<void> {
  const from = config.mail.from;
  const message = [
    `From: ${from}`,
    `To: ${mail.to}`,
    `Subject: ${mail.subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    mail.body,
  ].join('\r\n');

  await new Promise<void>((resolve, reject) => {
    const socket = createConnection({ host: config.mail.host, port: config.mail.port });
    const steps = [
      `EHLO everyweek\r\n`,
      `MAIL FROM:<${addressOnly(from)}>\r\n`,
      `RCPT TO:<${mail.to}>\r\n`,
      `DATA\r\n`,
      `${message.replace(/\r\n\./g, '\r\n..')}\r\n.\r\n`,
      `QUIT\r\n`,
    ];
    let step = -1;
    let buffer = '';
    socket.setTimeout(5000);
    const fail = (err: Error) => {
      socket.destroy();
      reject(err);
    };
    socket.on('error', fail);
    socket.on('timeout', () => fail(new Error('smtp_timeout')));
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      while (true) {
        const end = buffer.indexOf('\r\n');
        if (end === -1) break;
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (/^\d{3}-/.test(line)) continue;
        const code = Number(line.slice(0, 3));
        if (code >= 400) return fail(new Error(`smtp_${code}`));
        step += 1;
        if (step >= steps.length) {
          socket.end();
          resolve();
          return;
        }
        socket.write(steps[step]);
      }
    });
    socket.on('close', () => resolve());
  });
}

export async function sendMailQuietly(mail: Mail): Promise<void> {
  try {
    await sendMail(mail);
  } catch {
    /* mail service unreachable: everything else keeps working */
  }
}
