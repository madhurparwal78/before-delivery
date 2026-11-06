import { createConnection } from 'node:net';
import { config } from '../config.ts';

interface Dialogue {
  readonly send: (line: string) => void;
  readonly expect: (prefix: string) => Promise<void>;
  readonly end: () => void;
}

function openDialogue(): Promise<Dialogue> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: config.mail.host, port: config.mail.port });
    socket.setTimeout(10_000);
    let buffer = '';
    let waiting: { prefix: string; resolve: () => void; reject: (error: Error) => void } | null = null;

    const settle = (): void => {
      if (!waiting) return;
      const match = buffer.match(/^(\d{3})(?: |-)/);
      if (!match) return;
      const lines = buffer.split('\r\n');
      const final = lines.find((line) => /^\d{3} /.test(line));
      if (final === undefined) return;
      buffer = '';
      const pending = waiting;
      waiting = null;
      if (final.startsWith(pending.prefix)) pending.resolve();
      else pending.reject(new Error(`smtp said ${final}`));
    };

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      settle();
    });
    socket.on('error', (error) => {
      if (waiting) waiting.reject(error);
      else reject(error);
    });
    socket.on('timeout', () => {
      socket.destroy(new Error('smtp timed out'));
    });
    socket.on('connect', () => {
      resolve({
        send: (line: string) => socket.write(`${line}\r\n`),
        expect: (prefix: string) =>
          new Promise<void>((ok, bad) => {
            waiting = { prefix, resolve: ok, reject: bad };
            settle();
          }),
        end: () => socket.end(),
      });
    });
  });
}

function headerValue(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function addressOf(mailbox: string): string {
  const match = mailbox.match(/<([^>]+)>/);
  return match ? (match[1] as string) : mailbox;
}

function dotStuff(body: string): string {
  return body
    .split('\n')
    .map((line) => (line.startsWith('.') ? `.${line}` : line))
    .join('\r\n');
}

export async function sendMail(to: string, subject: string, body: string): Promise<void> {
  const dialogue = await openDialogue();
  try {
    await dialogue.expect('220');
    dialogue.send('EHLO kilndesk');
    await dialogue.expect('250');
    dialogue.send(`MAIL FROM:<${addressOf(config.mail.from)}>`);
    await dialogue.expect('250');
    dialogue.send(`RCPT TO:<${to}>`);
    await dialogue.expect('250');
    dialogue.send('DATA');
    await dialogue.expect('354');
    const headers = [
      `From: ${config.mail.from}`,
      `To: ${to}`,
      `Subject: ${headerValue(subject)}`,
      `Date: ${new Date().toUTCString()}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: 8bit',
    ].join('\r\n');
    dialogue.send(`${headers}\r\n\r\n${dotStuff(body)}\r\n.`);
    await dialogue.expect('250');
    dialogue.send('QUIT');
  } finally {
    dialogue.end();
  }
}
