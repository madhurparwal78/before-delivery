import { connect, type Socket } from 'node:net';
import { CONFIG } from '../config.js';

/**
 * Minimal SMTP client for the Mailpit sink. Speaks plain SMTP, one message
 * per notification, and reports whether the mail server accepted it.
 */

type Reply = { code: number; lines: string[] };

function readReply(socket: Socket, timeoutMs: number): Promise<Reply> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const lines: string[] = [];
    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString('utf8');
      let index = buffer.indexOf('\r\n');
      while (index >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        if (line.length >= 3 && /^\d{3}/.test(line)) {
          const code = Number.parseInt(line.slice(0, 3), 10);
          lines.push(line.slice(4));
          // A reply ends at a line whose fourth character is a space.
          if (line[3] === ' ') {
            cleanup();
            resolve({ code, lines });
          }
        }
        index = buffer.indexOf('\r\n');
      }
    };
    const onError = (err: Error): void => {
      cleanup();
      reject(err);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('smtp timeout'));
    }, timeoutMs);
    const cleanup = (): void => {
      clearTimeout(timer);
      socket.removeListener('data', onData);
      socket.removeListener('error', onError);
    };
    socket.on('data', onData);
    socket.on('error', onError);
  });
}

function writeCommand(socket: Socket, command: string): void {
  socket.write(`${command}\r\n`);
}

/** Sends one message; true only when the mail server accepts it. */
export async function sendEmail(to: string, subject: string, body: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(CONFIG.smtpPort, CONFIG.smtpHost);
    socket.setTimeout(10000);
    const fromMatch = /<([^>]+)>/.exec(CONFIG.mailFrom);
    const fromAddress = fromMatch !== null ? fromMatch[1] : CONFIG.mailFrom;
    let settled = false;
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.on('error', () => finish(false));
    socket.on('timeout', () => finish(false));
    void (async () => {
      try {
        await readReply(socket, 4000);                        // 220 greeting
        writeCommand(socket, 'HELO roamhouse.local');
        await readReply(socket, 4000);
        writeCommand(socket, `MAIL FROM:<${fromAddress}>`);
        await readReply(socket, 4000);
        writeCommand(socket, `RCPT TO:<${to}>`);
        await readReply(socket, 4000);
        writeCommand(socket, 'DATA');
        await readReply(socket, 4000);                        // 354
        const message = [
          `From: ${CONFIG.mailFrom}`,
          `To: ${to}`,
          `Subject: ${subject}`,
          'Content-Type: text/plain; charset=utf-8',
          '',
          body,
        ].join('\r\n');
        socket.write(message.replace(/\r?\n\./g, '\r\n..'));
        socket.write('\r\n.\r\n');
        const accepted = await readReply(socket, 6000);       // 250
        writeCommand(socket, 'QUIT');
        finish(accepted.code >= 200 && accepted.code < 300);
      } catch {
        finish(false);
      }
    })();
  });
}
