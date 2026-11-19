import { createConnection } from 'node:net';

/** A plain SMTP conversation with the local mail sink: no auth, no TLS. */
export function sendMail(options: {
  host: string;
  port: number;
  from: string;
  to: string;
  message: string;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: options.host, port: options.port });
    const script = [
      'EHLO jarful',
      `MAIL FROM:<${address(options.from)}>`,
      `RCPT TO:<${options.to}>`,
      'DATA',
      `${options.message}\r\n.`,
      'QUIT',
    ];
    let step = -1;
    let buffer = '';

    const fail = (error: Error): void => {
      socket.destroy();
      reject(error);
    };

    socket.setTimeout(5000, () => fail(new Error('smtp timeout')));
    socket.on('error', fail);
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let line = buffer.lastIndexOf('\r\n');
      if (line === -1) return;
      const complete = buffer.slice(0, line);
      buffer = buffer.slice(line + 2);
      const last = complete.split('\r\n').filter((text) => /^\d{3} /.test(text)).pop();
      if (!last) return;
      if (last.startsWith('4') || last.startsWith('5')) {
        fail(new Error(`smtp refused: ${last}`));
        return;
      }
      step += 1;
      if (step >= script.length) {
        socket.end();
        resolve();
        return;
      }
      socket.write(`${script[step]}\r\n`);
      if (script[step] === 'QUIT') {
        socket.end();
        resolve();
      }
    });
  });
}

function address(from: string): string {
  const match = /<([^>]+)>/.exec(from);
  return match ? match[1] : from;
}

function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

/** An RFC 5322 message, with the body base64-encoded when it is not plain ASCII. */
export function buildMessage(from: string, to: string, subject: string, body: string): string {
  // eslint-disable-next-line no-control-regex
  const ascii = /^[\x09\x0a\x0d\x20-\x7e]*$/.test(body);
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    `Content-Transfer-Encoding: ${ascii ? '7bit' : 'base64'}`,
  ];
  const content = ascii
    ? body
        .split('\n')
        .map((line) => (line.startsWith('.') ? `.${line}` : line))
        .join('\r\n')
    : (Buffer.from(body, 'utf8').toString('base64').match(/.{1,76}/g) ?? []).join('\r\n');
  return `${headers.join('\r\n')}\r\n\r\n${content}`;
}
