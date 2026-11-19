import { Socket } from 'node:net';

export interface MailMessage {
  to: string;
  subject: string;
  body: string;
}

interface Reply {
  code: number;
  lines: string[];
}

/**
 * Sends one plain-text message with a minimal blocking SMTP conversation.
 * Mailpit answers pipelined commands, so each command waits for its reply.
 */
export async function smtpSend(host: string, port: number, from: string, msg: MailMessage): Promise<void> {
  const envelopeFrom = /<([^>]+)>/.exec(from)?.[1] ?? from;
  const socket = new Socket();
  const chunks: Buffer[] = [];
  let buffer = '';
  const pending: Reply[] = [];

  const readReply = (): Promise<Reply> =>
    new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = () => {
        const idx = findReply(buffer);
        if (idx) {
          buffer = idx.rest;
          resolve(idx.reply);
          return;
        }
        if (Date.now() - started > 8000) {
          reject(new Error('smtp timeout'));
          return;
        }
        setTimeout(tick, 15);
      };
      tick();
    });

  const findReply = (buf: string): { reply: Reply; rest: string } | null => {
    const idx = buf.indexOf('\r\n');
    if (idx < 0) return null;
    let end = -1;
    let pos = 0;
    while (true) {
      const lineEnd = buf.indexOf('\r\n', pos);
      if (lineEnd < 0) return null;
      if (/^\d{3}-/.test(buf.slice(pos, lineEnd))) {
        pos = lineEnd + 2;
        continue;
      }
      if (/^\d{3} /.test(buf.slice(pos, lineEnd))) {
        end = lineEnd + 2;
        break;
      }
      return null;
    }
    const block = buf.slice(0, end);
    const lines = block.split('\r\n').filter((l) => l.length > 0);
    const code = Number(block.slice(0, 3));
    void chunks;
    void pending;
    return { reply: { code, lines }, rest: buf.slice(end) };
  };

  const connect = () =>
    new Promise<void>((resolve, reject) => {
      socket.connect(port, host);
      socket.on('error', reject);
      socket.on('data', (c: Buffer) => {
        buffer += c.toString('utf8');
      });
      socket.on('connect', () => resolve());
    });

  const send = (line: string) => {
    socket.write(line + '\r\n');
  };

  try {
    await connect();
    const greeting = await readReply();
    if (greeting.code !== 220) throw new Error(`smtp greeting ${greeting.code}`);
    send(`HELO rulehouse`);
    let r = await readReply();
    if (r.code !== 250) throw new Error(`smtp helo ${r.code}`);
    send(`MAIL FROM:<${envelopeFrom}>`);
    r = await readReply();
    if (r.code !== 250) throw new Error(`smtp mail from ${r.code}`);
    send(`RCPT TO:<${msg.to}>`);
    r = await readReply();
    if (r.code !== 250 && r.code !== 251) throw new Error(`smtp rcpt ${r.code}`);
    send(`DATA`);
    r = await readReply();
    if (r.code !== 354) throw new Error(`smtp data ${r.code}`);
    const safeBody = msg.body.replace(/\r?\n/g, '\r\n').replace(/(^|\r\n)\./g, '$1..');
    const message = [
      `From: ${from}`,
      `To: ${msg.to}`,
      `Subject: ${msg.subject}`,
      `MIME-Version: 1.0`,
      `Content-Type: text/plain; charset=utf-8`,
      ``,
      safeBody,
    ].join('\r\n');
    socket.write(message);
    send(``);
    send(`.`);
    r = await readReply();
    if (r.code !== 250) throw new Error(`smtp body ${r.code}`);
    send(`QUIT`);
  } finally {
    socket.destroy();
  }
}
