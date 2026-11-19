/**
 * The invite email: one place sends it, encodes its Subject per RFC 2047 and
 * folds it, with no delivery state kept between attempts.
 */
import { Socket } from 'node:net';

export interface InviteEmail {
  from: string;
  to: string;
  subjectDecoded: string;
  body: string;
}

/** RFC 2047 encoded-words, folded with CRLF SPACE, each word whole characters. */
export function encodeSubject(decoded: string): string {
  if (/^[\x20-\x7E]*$/.test(decoded)) return decoded;
  // the whole subject becomes one run of encoded-words, so decoders ignore
  // the folding whitespace and rebuild the text exactly
  const words: string[] = [];
  let chunk = Buffer.alloc(0);
  const flush = (): void => {
    if (chunk.length > 0) {
      words.push(`=?UTF-8?B?${chunk.toString('base64')}?=`);
      chunk = Buffer.alloc(0);
    }
  };
  for (const ch of decoded) {
    const bytes = Buffer.from(ch, 'utf8');
    if (chunk.length + bytes.length > 39) {
      flush();
    }
    chunk = Buffer.concat([chunk, bytes]);
  }
  flush();
  return words.join('\r\n ');
}

/** Build the full message text with a plain-ASCII header block. */
export function buildMessage(email: InviteEmail): string {
  const headers = [
    `From: ${email.from}`,
    `To: ${email.to}`,
    `Subject: ${encodeSubject(email.subjectDecoded)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
  ];
  return `${headers.join('\r\n')}\r\n\r\n${email.body}\r\n.\r\n`;
}

/** Send one invite over a fresh SMTP connection, giving up after 5 seconds. */
export function sendMail(host: string, port: number, email: InviteEmail): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    let buffer = '';
    let stage = 0;
    const message = buildMessage(email);
    const fail = (err: Error): void => {
      clearTimeout(timer);
      socket.destroy();
      reject(err);
    };
    const timer = setTimeout(() => fail(new Error('smtp timeout')), 5000);
    const step = (): void => {
      // stage 0: greeting arrived, send EHLO; 1: MAIL FROM; 2: RCPT TO;
      // 3: DATA; 4: the message; 5: QUIT
      if (stage === 0) socket.write('EHLO tallyframe\r\n');
      else if (stage === 1) socket.write(`MAIL FROM:<${envelopeAddress(email.from)}>\r\n`);
      else if (stage === 2) socket.write(`RCPT TO:<${email.to}>\r\n`);
      else if (stage === 3) socket.write('DATA\r\n');
      else if (stage === 4) socket.write(message);
      else if (stage === 5) {
        socket.write('QUIT\r\n');
        clearTimeout(timer);
        socket.end();
        resolve();
        return;
      }
      stage++;
    };
    socket.connect(port, host);
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\r\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const code = parseInt(line.slice(0, 3), 10);
        if (Number.isNaN(code)) continue;
        const isFinal = line.length < 4 || line[3] !== '-';
        if (!isFinal) continue;
        if (code >= 400) {
          fail(new Error(`smtp refused: ${line}`));
          return;
        }
        step();
      }
    });
    socket.on('error', (err: Error) => fail(err));
  });
}

/** The bare address from a From line like `Tallyframe <invites@harbourlane.test>`. */
export function envelopeAddress(from: string): string {
  const match = /<([^>]+)>/.exec(from);
  return match ? match[1]! : from;
}
