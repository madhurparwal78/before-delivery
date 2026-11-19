import { randomUUID } from 'node:crypto';
import { createConnection, type Socket } from 'node:net';

export interface Envelope {
  host: string;
  port: number;
  from: string;
  to: string;
  subject: string;
  text: string;
}

/** The address inside `Name <address>`, or the value itself. */
function addressOf(value: string): string {
  const angled = /<([^>]+)>/.exec(value);
  return (angled?.[1] ?? value).trim();
}

function encodeHeader(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function body(envelope: Envelope): string {
  const lines = envelope.text.split(/\r?\n/).map((line) => (line === '.' ? '..' : line));
  return [
    `From: ${encodeHeader(envelope.from)}`,
    `To: ${envelope.to}`,
    `Subject: ${encodeHeader(envelope.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@twigline>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    ...lines
  ].join('\r\n');
}

/** One SMTP dialogue. Resolves once the server has accepted the message. */
export function sendOverSmtp(envelope: Envelope): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const steps: Array<{ send: string | null; expect: number }> = [
      { send: null, expect: 220 },
      { send: `EHLO twigline`, expect: 250 },
      { send: `MAIL FROM:<${addressOf(envelope.from)}>`, expect: 250 },
      { send: `RCPT TO:<${addressOf(envelope.to)}>`, expect: 250 },
      { send: 'DATA', expect: 354 },
      { send: `${body(envelope)}\r\n.`, expect: 250 },
      { send: 'QUIT', expect: 221 }
    ];
    let step = 0;
    let buffer = '';
    let settled = false;
    const socket: Socket = createConnection({ host: envelope.host, port: envelope.port });
    socket.setTimeout(6_000);

    const fail = (reason: string): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(new Error(reason));
    };
    const done = (): void => {
      if (settled) return;
      settled = true;
      socket.end();
      resolve();
    };

    const advance = (): void => {
      step += 1;
      const next = steps[step];
      if (next === undefined) {
        done();
        return;
      }
      if (next.send !== null) socket.write(`${next.send}\r\n`);
    };

    socket.on('connect', () => {
      // the greeting arrives unprompted; the first step only waits for it
    });
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      for (;;) {
        const end = buffer.indexOf('\r\n');
        if (end === -1) return;
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (/^\d{3}-/.test(line)) continue;
        const code = Number(line.slice(0, 3));
        const expected = steps[step]?.expect;
        if (expected === undefined) return;
        if (code !== expected) {
          fail(`smtp ${line}`);
          return;
        }
        if (step === steps.length - 1) {
          done();
          return;
        }
        advance();
      }
    });
    socket.on('timeout', () => fail('smtp timeout'));
    socket.on('error', (error) => fail(error.message));
    socket.on('close', () => {
      if (!settled) fail('smtp closed');
    });
  });
}
