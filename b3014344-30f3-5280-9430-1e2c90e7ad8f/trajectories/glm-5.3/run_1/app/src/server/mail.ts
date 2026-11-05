import net from 'node:net';
import { config } from './util.js';

export class MailError extends Error {}

export async function mailHealthy(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: config.mail.host, port: config.mail.port });
    socket.setTimeout(1_500);
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function readReply(socket: net.Socket): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      if (/\r?\n\d{3} /.test(buffer) || /^\d{3} /.test(buffer)) {
        cleanup();
        resolve(buffer);
      }
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      socket.off('data', onData);
      socket.off('error', onError);
    };
    socket.on('data', onData);
    socket.on('error', onError);
  });
}

async function command(socket: net.Socket, expected: number, cmd?: string): Promise<string> {
  if (cmd !== undefined) {
    await new Promise<void>((resolve, reject) => {
      socket.write(`${cmd}\r\n`, (err) => (err ? reject(err) : resolve()));
    });
  }
  const reply = await readReply(socket);
  const code = Number(reply.slice(0, 3));
  if (Math.floor(code / 100) !== Math.floor(expected / 100)) {
    throw new MailError(`SMTP unexpected reply: ${reply.trim()}`);
  }
  return reply;
}

export async function sendMail(to: string, subject: string, body: string): Promise<void> {
  const socket = net.createConnection({ host: config.mail.host, port: config.mail.port });
  socket.setTimeout(20_000);
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
    });
    await command(socket, 220);
    await command(socket, 250, `HELO pampero`);
    await command(socket, 250, `MAIL FROM:<${config.mail.from.replace(/.*</, '').replace(/>$/, '')}>`);
    await command(socket, 250, `RCPT TO:<${to}>`);
    await command(socket, 354, `DATA`);
    const message = [
      `From: ${config.mail.from}`,
      `To: <${to}>`,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      '',
      body,
      '',
    ].join('\r\n');
    socket.write(message.replace(/\r?\n\./g, '\r\n..'));
    await command(socket, 250, '.');
    await command(socket, 221, 'QUIT');
  } finally {
    socket.destroy();
  }
}
