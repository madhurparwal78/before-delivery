import { createConnection, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { AppError } from '../http/app-error.js';

export class EmailUnavailable extends AppError {
  constructor() {
    super('email_unavailable');
  }
}

export type Attachment = { filename: string; contentType: string; bytes: Buffer };

export type Email = {
  to: string;
  subject: string;
  text: string;
  attachments?: Attachment[];
};

const encodeHeaderWord = (value: string): string =>
  /^[\x20-\x7e]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;

const wrapBase64 = (bytes: Buffer): string => {
  const encoded = bytes.toString('base64');
  const lines: string[] = [];
  for (let index = 0; index < encoded.length; index += 76)
    lines.push(encoded.slice(index, index + 76));
  return lines.join('\r\n');
};

const fromAddress = (): string => {
  const match = /<([^>]+)>/.exec(config.mail.from);
  return match ? match[1] : config.mail.from;
};

const buildMessage = (email: Email): string => {
  const boundary = `gw-${randomUUID()}`;
  const attachments = email.attachments ?? [];
  const head = [
    `From: ${config.mail.from}`,
    `To: ${email.to}`,
    `Subject: ${encodeHeaderWord(email.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@gloamwork.test>`,
    'MIME-Version: 1.0',
  ];

  if (attachments.length === 0) {
    head.push('Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64');
    return `${head.join('\r\n')}\r\n\r\n${wrapBase64(Buffer.from(email.text, 'utf8'))}\r\n`;
  }

  head.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  const parts = [
    `--${boundary}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrapBase64(Buffer.from(email.text, 'utf8'))}`,
    ...attachments.map(
      (attachment) =>
        `--${boundary}\r\nContent-Type: ${attachment.contentType}\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename="${attachment.filename}"\r\n\r\n${wrapBase64(attachment.bytes)}`,
    ),
  ];
  return `${head.join('\r\n')}\r\n\r\n${parts.join('\r\n')}\r\n--${boundary}--\r\n`;
};

type Session = {
  expect: (codes: number[]) => Promise<string>;
  send: (line: string) => void;
  end: () => void;
};

const openSession = async (): Promise<Session> => {
  const socket: Socket = await new Promise((resolve, reject) => {
    const candidate = createConnection({ host: config.mail.host, port: config.mail.port });
    candidate.setTimeout(15_000);
    candidate.once('connect', () => resolve(candidate));
    candidate.once('timeout', () => {
      candidate.destroy();
      reject(new EmailUnavailable());
    });
    candidate.once('error', () => reject(new EmailUnavailable()));
  });

  let pending = '';
  const replies: string[] = [];
  const waiters: ((value: string | Error) => void)[] = [];

  const flush = (): void => {
    while (replies.length > 0 && waiters.length > 0) waiters.shift()?.(replies.shift() as string);
  };

  socket.on('data', (chunk) => {
    pending += chunk.toString('utf8');
    let lines: string[] = [];
    let index = pending.indexOf('\r\n');
    while (index !== -1) {
      const line = pending.slice(0, index);
      pending = pending.slice(index + 2);
      lines.push(line);
      if (/^\d{3} /.test(line)) {
        replies.push(lines.join('\n'));
        lines = [];
      }
      index = pending.indexOf('\r\n');
    }
    pending = lines.length > 0 ? `${lines.join('\r\n')}\r\n${pending}` : pending;
    flush();
  });

  const failAll = (): void => {
    while (waiters.length > 0) waiters.shift()?.(new EmailUnavailable());
  };
  socket.on('error', failAll);
  socket.on('close', failAll);
  socket.on('timeout', () => {
    socket.destroy();
    failAll();
  });

  return {
    expect: async (codes) => {
      const reply = await new Promise<string>((resolve, reject) => {
        waiters.push((value) => (value instanceof Error ? reject(value) : resolve(value)));
        flush();
      });
      const last = reply.split('\n').at(-1) ?? '';
      if (!codes.includes(Number.parseInt(last.slice(0, 3), 10))) throw new EmailUnavailable();
      return reply;
    },
    send: (line) => {
      socket.write(`${line}\r\n`);
    },
    end: () => socket.destroy(),
  };
};

export const sendEmail = async (email: Email): Promise<void> => {
  const session = await openSession();
  try {
    await session.expect([220]);
    session.send('EHLO gloamwork-shot-rig');
    await session.expect([250]);
    session.send(`MAIL FROM:<${fromAddress()}>`);
    await session.expect([250]);
    session.send(`RCPT TO:<${email.to}>`);
    await session.expect([250, 251]);
    session.send('DATA');
    await session.expect([354]);
    const message = buildMessage(email).replace(/\r\n\./g, '\r\n..');
    session.send(`${message.replace(/\r\n$/, '')}\r\n.`);
    await session.expect([250]);
    session.send('QUIT');
  } finally {
    session.end();
  }
};

export const emailUp = async (): Promise<boolean> => {
  try {
    const session = await openSession();
    try {
      await session.expect([220]);
      session.send('QUIT');
      return true;
    } finally {
      session.end();
    }
  } catch {
    return false;
  }
};
