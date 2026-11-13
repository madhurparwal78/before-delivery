/** SMTP client for the notice relay: plain socket, no authentication,
 *  one message per recipient. Waits for each reply's last line before
 *  the next command, per RFC 5321 multiline replies. */
import * as net from 'node:net';

export interface MailMessage {
  from: string;
  to: string;
  subject: string;
  body: string;
  messageId: string;
}

export class MailUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MailUnavailable';
  }
}

export async function sendMail(host: string, port: number, msg: MailMessage): Promise<void> {
  const socket = net.createConnection({ host, port });
  socket.setNoDelay(true);
  const commands: Array<{ match: number; write: string }> = [
    { match: 220, write: `EHLO twohouse\r\n` },
    { match: 250, write: `MAIL FROM:<${extractAddress(msg.from)}>\r\n` },
    { match: 250, write: `RCPT TO:<${msg.to}>\r\n` },
    { match: 250, write: `DATA\r\n` },
    { match: 354, write: messageBody(msg) },
    { match: 250, write: `QUIT\r\n` },
  ];
  await new Promise<void>((resolve, reject) => {
    let buffer = '';
    let index = 0;
    let settled = false;
    const fail = (err: Error) => {
      if (!settled) {
        settled = true;
        socket.destroy();
        reject(new MailUnavailable(err.message));
      }
    };
    socket.setTimeout(5000, () => fail(new Error('timeout')));
    socket.on('error', fail);
    socket.on('close', () => {
      if (!settled) fail(new Error('closed early'));
    });
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\r\n');
      if (lines.length < 2) return;
      const lastComplete = lines[lines.length - 2];
      if (!/^\d{3} /.test(lastComplete)) return;
      const code = parseInt(lastComplete.slice(0, 3), 10);
      buffer = lines[lines.length - 1];
      const step = commands[index];
      if (!step) return fail(new Error('unexpected reply'));
      if (code >= 500 || (code >= 400 && code !== step.match)) {
        return fail(new Error(`SMTP refused: ${lastComplete}`));
      }
      if (code !== step.match) return fail(new Error(`expected ${step.match} got ${code}`));
      socket.write(step.write);
      index += 1;
      if (index === commands.length) {
        settled = true;
        socket.end();
        resolve();
      }
    });
  });
}

function messageBody(msg: MailMessage): string {
  // headers, one blank line, then the body; CRLF endings throughout
  const headers = [
    `From: ${msg.from}`,
    `To: ${msg.to}`,
    `Subject: ${msg.subject}`,
    `Message-ID: <${msg.messageId}>`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=utf-8`,
    ``,
    ``,
  ].join('\r\n');
  const dotted = msg.body.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n').replace(/^\.\r\n/gm, '..\r\n');
  return `${headers}${dotted}\r\n.\r\n`;
}

function extractAddress(from: string): string {
  const m = /<([^>]+)>/.exec(from);
  return m ? m[1] : from;
}
