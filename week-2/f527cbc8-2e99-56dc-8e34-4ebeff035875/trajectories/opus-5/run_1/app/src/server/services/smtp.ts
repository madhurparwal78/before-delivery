import { createConnection, type Socket } from 'node:net';
import { config, limits } from '../config.js';

/**
 * A plain SMTP submission against Mailpit. Mailpit needs no authentication and no TLS,
 * so this speaks just enough of the protocol, with an explicit timeout on every step.
 */
export class MailUnavailable extends Error {
  constructor(cause?: unknown) {
    super('mail transport is unreachable');
    this.name = 'MailUnavailable';
    this.cause = cause;
  }
}

interface Conversation {
  expect(codes: readonly number[]): Promise<string>;
  send(line: string): void;
  sendRaw(payload: Buffer): void;
  end(): void;
}

function conversation(socket: Socket): Conversation {
  let buffer = '';
  const waiters: { resolve: (value: string) => void; reject: (error: Error) => void; codes: readonly number[] }[] = [];

  // A reply is any number of `<code>-` continuation lines followed by one `<code> ` line.
  const replyPattern = /^(?:\d{3}-[^\n]*\n)*(\d{3})(?: [^\n]*)?\n/;

  const settle = (): void => {
    while (waiters.length > 0) {
      const match = replyPattern.exec(buffer);
      if (match === null) return;
      const waiter = waiters.shift();
      if (waiter === undefined) return;
      const reply = match[0];
      buffer = buffer.slice(reply.length);
      const code = Number(match[1]);
      if (waiter.codes.includes(code)) waiter.resolve(reply);
      else waiter.reject(new MailUnavailable(`smtp answered ${reply.trim()}`));
    }
  };

  socket.setEncoding('utf8');
  socket.on('data', (chunk: string) => {
    buffer += chunk;
    settle();
  });
  socket.on('error', (error) => {
    while (waiters.length > 0) waiters.shift()?.reject(new MailUnavailable(error));
  });
  socket.on('close', () => {
    while (waiters.length > 0) waiters.shift()?.reject(new MailUnavailable('smtp closed'));
  });

  return {
    expect(codes) {
      return new Promise<string>((resolve, reject) => {
        waiters.push({ resolve, reject, codes });
        settle();
      });
    },
    send(line) {
      socket.write(`${line}\r\n`, 'utf8');
    },
    sendRaw(payload) {
      socket.write(payload);
    },
    end() {
      socket.destroy();
    },
  };
}

function dotStuff(body: string): Buffer {
  const normalised = body.replace(/\r?\n/g, '\r\n').replace(/\r\n\./g, '\r\n..');
  const prefixed = normalised.startsWith('.') ? `.${normalised}` : normalised;
  return Buffer.from(`${prefixed}\r\n.\r\n`, 'utf8');
}

function headerValue(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function envelopeAddress(from: string): string {
  const angled = /<([^>]+)>/.exec(from);
  return angled === null ? from.trim() : (angled[1] as string);
}

export interface OutgoingEmail {
  to: string;
  subject: string;
  body: string;
}

export async function sendEmail(message: OutgoingEmail): Promise<void> {
  const socket = await new Promise<Socket>((resolve, reject) => {
    const candidate = createConnection({ host: config.smtp.host, port: config.smtp.port });
    const timer = setTimeout(() => {
      candidate.destroy();
      reject(new MailUnavailable('connect timed out'));
    }, limits.providerTimeoutMs);
    candidate.once('connect', () => {
      clearTimeout(timer);
      resolve(candidate);
    });
    candidate.once('error', (error) => {
      clearTimeout(timer);
      reject(new MailUnavailable(error));
    });
  });

  socket.setTimeout(limits.providerTimeoutMs, () => socket.destroy());
  const talk = conversation(socket);
  const deadline = setTimeout(() => socket.destroy(), limits.providerTimeoutMs * 3);

  try {
    await talk.expect([220]);
    talk.send('EHLO clinchline');
    await talk.expect([250]);
    talk.send(`MAIL FROM:<${envelopeAddress(config.smtp.from)}>`);
    await talk.expect([250]);
    talk.send(`RCPT TO:<${envelopeAddress(message.to)}>`);
    await talk.expect([250, 251]);
    talk.send('DATA');
    await talk.expect([354]);

    const headers = [
      `From: ${config.smtp.from}`,
      `To: ${message.to}`,
      `Subject: ${headerValue(message.subject)}`,
      `Date: ${new Date().toUTCString()}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      '',
    ].join('\r\n');
    talk.sendRaw(Buffer.concat([Buffer.from(headers, 'utf8'), dotStuff(message.body)]));
    await talk.expect([250]);
    talk.send('QUIT');
  } finally {
    clearTimeout(deadline);
    talk.end();
  }
}

export async function mailHealthy(timeoutMs: number): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const socket = createConnection({ host: config.smtp.host, port: config.smtp.port });
    const finish = (healthy: boolean): void => {
      socket.destroy();
      resolve(healthy);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timer);
      finish(true);
    });
    socket.once('error', () => {
      clearTimeout(timer);
      finish(false);
    });
  });
}
