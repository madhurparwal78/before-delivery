import { randomUUID } from 'node:crypto';
import { createConnection } from 'node:net';
import { config } from '../config.js';

export type MailAttachment = {
  fileName: string;
  contentType: string;
  body: string;
};

export type Mail = {
  to: string;
  subject: string;
  text: string;
  attachments?: MailAttachment[];
};

/** All mail is sent over SMTP from the MAIL_FROM value. */
export async function sendMail(mail: Mail): Promise<void> {
  const fromAddress = addressOf(config.smtp.from);
  const message = compose(mail);
  await talk([
    { expect: 220 },
    { say: `EHLO clapstick`, expect: 250 },
    { say: `MAIL FROM:<${fromAddress}>`, expect: 250 },
    { say: `RCPT TO:<${addressOf(mail.to)}>`, expect: 250 },
    { say: 'DATA', expect: 354 },
    { say: `${message}\r\n.`, expect: 250 },
    { say: 'QUIT', expect: 221 },
  ]);
}

function addressOf(value: string): string {
  const angled = /<([^>]+)>/.exec(value);
  return angled?.[1] ?? value.trim();
}

function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function compose(mail: Mail): string {
  const headers = [
    `From: ${config.smtp.from}`,
    `To: ${mail.to}`,
    `Subject: ${encodeHeader(mail.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@noorbakkerboards.example>`,
    'MIME-Version: 1.0',
  ];
  const attachments = mail.attachments ?? [];
  if (attachments.length === 0) {
    headers.push('Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64');
    return `${headers.join('\r\n')}\r\n\r\n${wrapBase64(Buffer.from(mail.text, 'utf8'))}`;
  }
  const boundary = `clapstick-${randomUUID()}`;
  headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  const parts = [
    [
      `--${boundary}`,
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      wrapBase64(Buffer.from(mail.text, 'utf8')),
    ].join('\r\n'),
    ...attachments.map((attachment) =>
      [
        `--${boundary}`,
        `Content-Type: ${attachment.contentType}; name="${attachment.fileName}"`,
        'Content-Transfer-Encoding: base64',
        `Content-Disposition: attachment; filename="${attachment.fileName}"`,
        '',
        wrapBase64(Buffer.from(attachment.body, 'utf8')),
      ].join('\r\n'),
    ),
  ];
  return `${headers.join('\r\n')}\r\n\r\n${parts.join('\r\n')}\r\n--${boundary}--`;
}

function wrapBase64(body: Buffer): string {
  return (body.toString('base64').match(/.{1,76}/g) ?? ['']).join('\r\n');
}

type Step = { say?: string; expect: number };

async function talk(steps: readonly Step[]): Promise<void> {
  const socket = createConnection({ host: config.smtp.host, port: config.smtp.port });
  socket.setTimeout(10000);
  const lines = replyReader(socket);
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
    });
    for (const step of steps) {
      if (step.say !== undefined) socket.write(`${step.say}\r\n`);
      const code = await lines.next();
      if (code !== step.expect) throw new Error(`smtp said ${code}`);
    }
  } finally {
    socket.destroy();
  }
}

/** Reads SMTP replies, treating `nnn-` lines as continuations of one reply. */
function replyReader(socket: ReturnType<typeof createConnection>): { next: () => Promise<number> } {
  let buffer = '';
  const waiting: Array<{ resolve: (code: number) => void; reject: (error: Error) => void }> = [];
  const pending: number[] = [];

  const settle = (): void => {
    while (pending.length > 0 && waiting.length > 0) {
      waiting.shift()?.resolve(pending.shift() as number);
    }
  };

  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let breakAt = buffer.indexOf('\r\n');
    while (breakAt !== -1) {
      const line = buffer.slice(0, breakAt);
      buffer = buffer.slice(breakAt + 2);
      if (/^\d{3}(?: .*)?$/.test(line)) pending.push(Number(line.slice(0, 3)));
      breakAt = buffer.indexOf('\r\n');
    }
    settle();
  });

  const fail = (error: Error): void => {
    while (waiting.length > 0) waiting.shift()?.reject(error);
  };
  socket.on('error', fail);
  socket.on('timeout', () => fail(new Error('smtp timeout')));
  socket.on('close', () => fail(new Error('smtp closed')));

  return {
    next: () =>
      new Promise<number>((resolve, reject) => {
        waiting.push({ resolve, reject });
        settle();
      }),
  };
}
