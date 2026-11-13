import { createConnection, type Socket } from 'node:net';
import { config } from '../config.js';

const TIMEOUT_MS = 5000;

export interface Message {
  to: string;
  subject: string;
  text: string;
}

function addressOf(from: string): string {
  const match = /<([^>]+)>/.exec(from);
  return match?.[1] ?? from.trim();
}

function dotStuff(body: string): string {
  return body
    .split(/\r?\n/)
    .map((line) => (line.startsWith('.') ? `.${line}` : line))
    .join('\r\n');
}

/** A minimal SMTP delivery for the two published messages. */
export function deliver(message: Message): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket: Socket = createConnection({ host: config.mail.host, port: config.mail.port });
    socket.setTimeout(TIMEOUT_MS);
    socket.setEncoding('utf8');

    const sender = addressOf(config.mail.from);
    const body = [
      `From: ${config.mail.from}`,
      `To: ${message.to}`,
      `Subject: ${message.subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      '',
      dotStuff(message.text),
      '.',
    ].join('\r\n');

    const steps = [
      `EHLO longrail.example`,
      `MAIL FROM:<${sender}>`,
      `RCPT TO:<${message.to}>`,
      'DATA',
      body,
      'QUIT',
    ];
    let step = -1;
    let buffer = '';
    let settled = false;

    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(error);
    };
    const done = (): void => {
      if (settled) return;
      settled = true;
      socket.end();
      resolve();
    };

    socket.on('error', fail);
    socket.on('timeout', () => fail(new Error('smtp timeout')));
    socket.on('close', () => {
      if (!settled) fail(new Error('smtp closed'));
    });

    socket.on('data', (chunk: string) => {
      buffer += chunk;
      let index = buffer.indexOf('\r\n');
      while (index >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        index = buffer.indexOf('\r\n');
        if (line.length > 3 && line[3] === '-') continue;
        const code = Number.parseInt(line.slice(0, 3), 10);
        if (code >= 400) {
          fail(new Error(`smtp refused: ${line}`));
          return;
        }
        step += 1;
        const next = steps[step];
        if (next === undefined) {
          done();
          return;
        }
        socket.write(`${next}\r\n`);
        if (next === 'QUIT') done();
      }
    });
  });
}

export async function smtpReachable(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: config.mail.host, port: config.mail.port });
    socket.setTimeout(TIMEOUT_MS);
    const finish = (value: boolean): void => {
      socket.destroy();
      resolve(value);
    };
    socket.on('data', (chunk: Buffer) => finish(chunk.toString('utf8').startsWith('220')));
    socket.on('error', () => finish(false));
    socket.on('timeout', () => finish(false));
  });
}
