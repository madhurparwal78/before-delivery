import { createConnection, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { env } from '../env';
import { ProviderDown } from '../http/errors';

export interface Message {
  to: string;
  subject: string;
  body: string;
}

const CRLF = '\r\n';

interface Dialogue {
  send(line: string, expect: number): Promise<void>;
  end(): void;
}

function open(host: string, port: number): Promise<{ socket: Socket; greeting: string }> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port });
    socket.setTimeout(10000);
    const fail = (error: Error): void => {
      socket.destroy();
      reject(error);
    };
    socket.once('error', fail);
    socket.once('timeout', () => fail(new Error('mail server timed out')));
    socket.once('data', (chunk) => {
      socket.removeListener('error', fail);
      resolve({ socket, greeting: chunk.toString('utf8') });
    });
  });
}

function dialogue(socket: Socket): Dialogue {
  return {
    send(line: string, expect: number): Promise<void> {
      return new Promise((resolve, reject) => {
        const onData = (chunk: Buffer): void => {
          cleanup();
          const reply = chunk.toString('utf8');
          const code = Number(reply.slice(0, 3));
          if (code === expect) resolve();
          else reject(new Error(`mail server answered ${reply.trim()}`));
        };
        const onError = (error: Error): void => {
          cleanup();
          reject(error);
        };
        const onTimeout = (): void => onError(new Error('mail server timed out'));
        const cleanup = (): void => {
          socket.removeListener('data', onData);
          socket.removeListener('error', onError);
          socket.removeListener('timeout', onTimeout);
        };
        socket.once('data', onData);
        socket.once('error', onError);
        socket.once('timeout', onTimeout);
        socket.write(line + CRLF);
      });
    },
    end(): void {
      socket.destroy();
    },
  };
}

function addressOf(from: string): string {
  const angled = /<([^>]+)>/.exec(from);
  return angled?.[1] ?? from;
}

function headerBlock(message: Message): string {
  return [
    `From: ${env.mailFrom}`,
    `To: ${message.to}`,
    `Subject: ${message.subject}`,
    `Message-ID: <${randomUUID()}@brickfieldlane.example>`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
  ].join(CRLF);
}

/** Dotted lines must be stuffed so the body cannot end the DATA command. */
function dotStuff(body: string): string {
  return body
    .split(/\r?\n/)
    .map((line) => (line.startsWith('.') ? `.${line}` : line))
    .join(CRLF);
}

/** Hands one message to the mail server and waits for it to be accepted. */
export async function sendMessage(message: Message): Promise<void> {
  let socket: Socket;
  try {
    ({ socket } = await open(env.smtp.host, env.smtp.port));
  } catch (error) {
    throw new ProviderDown('mail', error instanceof Error ? error.message : 'mail failed');
  }
  const smtp = dialogue(socket);
  try {
    await smtp.send('EHLO shelfmark', 250);
    await smtp.send(`MAIL FROM:<${addressOf(env.mailFrom)}>`, 250);
    await smtp.send(`RCPT TO:<${message.to}>`, 250);
    await smtp.send('DATA', 354);
    await smtp.send(`${headerBlock(message)}${CRLF}${CRLF}${dotStuff(message.body)}${CRLF}.`, 250);
    await smtp.send('QUIT', 221);
  } catch (error) {
    throw new ProviderDown('mail', error instanceof Error ? error.message : 'mail failed');
  } finally {
    smtp.end();
  }
}
