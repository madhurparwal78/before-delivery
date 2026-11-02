import net from 'node:net';
import { env } from '../env.js';

/** Minimal SMTP client for the internal Mailpit relay. */
export function sendMail(options: { from: string; to: string; subject: string; text: string }): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: env.smtp.host, port: env.smtp.port });
    socket.setTimeout(10_000);
    let buffer = '';
    let stage = 0;
    const fail = (err: Error): void => {
      socket.destroy();
      reject(err);
    };
    const commands: { payload: string | null; expect: number[] }[] = [
      { payload: null, expect: [220] },
      { payload: `EHLO ceibo.test`, expect: [250] },
      { payload: `MAIL FROM:<${bareAddress(options.from)}>`, expect: [250] },
      { payload: `RCPT TO:<${options.to}>`, expect: [250, 251] },
      { payload: `DATA`, expect: [354] },
    ];
    const message = [
      `From: ${options.from}`,
      `To: ${options.to}`,
      `Subject: ${options.subject.replace(/\r?\n/g, ' ')}`,
      `MIME-Version: 1.0`,
      `Content-Type: text/plain; charset=utf-8`,
      ``,
      options.text.replace(/\r?\n\./g, '\n..'),
      `.`,
    ].join('\r\n');
    const finish = (): void => {
      socket.end();
      resolve();
    };
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      if (!buffer.includes('\n')) return;
      const lines = buffer.split('\r\n');
      const last = lines[lines.length - 2] ?? lines[lines.length - 1];
      const code = Number(last.trim().slice(0, 3));
      buffer = '';
      if (Number.isNaN(code)) {
        fail(new Error(`smtp: unexpected response`));
        return;
      }
      const current = commands[stage];
      if (current && !current.expect.includes(code)) {
        fail(new Error(`smtp: expected ${current.expect.join('/')} got ${code}`));
        return;
      }
      stage += 1;
      if (stage < commands.length) {
        socket.write(`${commands[stage].payload}\r\n`);
      } else if (stage === commands.length) {
        socket.write(`${message}\r\n`);
        stage += 1;
      } else {
        socket.write(`QUIT\r\n`);
        finish();
      }
    });
    socket.on('timeout', () => fail(new Error('smtp: timeout')));
    socket.on('error', (err) => fail(err));
  });
}

function bareAddress(from: string): string {
  const match = /<([^>]+)>/.exec(from);
  return match ? match[1] : from;
}

export function isMailReachable(): Promise<boolean> {
  return sendMail({ from: 'probe@ceibo.test', to: 'probe@ceibo.test', subject: 'probe', text: 'probe' })
    .then(() => true)
    .catch(() => false);
}
