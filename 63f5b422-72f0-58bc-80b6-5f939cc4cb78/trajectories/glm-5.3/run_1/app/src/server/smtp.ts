// A minimal SMTP client (RFC 5321 basics) for Mailpit.
import net from 'node:net';
import { config } from './config.js';

export interface MailOptions { to: string; subject: string; text: string }

function readReply(socket: net.Socket): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      // a reply ends with a final line like "250 " (space, not hyphen)
      const lines = buffer.split('\r\n');
      const last = lines[lines.length - 2];
      if (last !== undefined && /^\d{3} /.test(last)) {
        socket.removeListener('data', onData);
        socket.removeListener('error', onErr);
        resolve(buffer);
      }
    };
    const onErr = (err: Error) => { socket.removeListener('data', onData); reject(err); };
    socket.on('data', onData);
    socket.on('error', onErr);
  });
}

async function sendCommand(socket: net.Socket, cmd: string): Promise<string> {
  socket.write(`${cmd}\r\n`);
  const reply = await readReply(socket);
  const code = Number(reply.slice(0, 3));
  if (code >= 400) throw new Error(`SMTP refused ${cmd.slice(0, 4)}: ${reply.trim()}`);
  return reply;
}

/** Sends one mail; resolves only after the server accepts the message. */
export function sendMail(opts: MailOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: config.smtp.host, port: config.smtp.port });
    socket.setTimeout(10_000);
    socket.on('error', (err) => reject(err));
    socket.on('timeout', () => { socket.destroy(); reject(new Error('SMTP timeout')); });
    socket.on('connect', () => {
      (async () => {
        await readReply(socket);
        await sendCommand(socket, 'EHLO plinth');
        await sendCommand(socket, `MAIL FROM:<${fromAddress()}>`);
        await sendCommand(socket, `RCPT TO:<${opts.to}>`);
        await sendCommand(socket, 'DATA');
        const body = [
          `From: ${config.mailFrom}`,
          `To: ${opts.to}`,
          `Subject: ${encodeHeader(opts.subject)}`,
          'MIME-Version: 1.0',
          'Content-Type: text/plain; charset=utf-8',
          '',
          opts.text.replace(/^\./gm, '..'),
          '.',
        ].join('\r\n');
        socket.write(`${body}\r\n`);
        await readReply(socket);
        await sendCommand(socket, 'QUIT');
        socket.end();
        resolve();
      })().catch(reject);
    });
  });
}

function fromAddress(): string {
  const m = /<([^>]+)>/.exec(config.mailFrom);
  return m ? m[1] : config.mailFrom;
}

/** Encode non-ASCII header values as RFC 2047 encoded words. */
function encodeHeader(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}
