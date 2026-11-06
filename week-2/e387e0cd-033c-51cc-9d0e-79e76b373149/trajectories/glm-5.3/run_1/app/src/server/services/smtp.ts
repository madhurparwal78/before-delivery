import { connect as netConnect, Socket } from 'node:net';
import { config } from '../config.js';

// Minimal SMTP client for Mailpit. Body lines are dot-stuffed.
export interface Mail { to: string; subject: string; textBody: string }

function dotStuff(body: string): string {
  return body.replace(/\r?\n/g, '\r\n').replace(/(^|\r\n)\./g, '$1..');
}

async function readResponse(socket: Socket): Promise<{ code: number; lines: string[] }> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\r\n');
      while (lines.length > 1) {
        const line = lines.shift()!;
        buffer = lines.join('\r\n');
        const code = Number(line.slice(0, 3));
        const isFinal = line.length < 4 || line[3] !== '-';
        if (isFinal && !Number.isNaN(code)) {
          socket.removeListener('data', onData);
          resolve({ code, lines: [line] });
          return;
        }
      }
    };
    socket.on('data', onData);
    socket.once('error', reject);
  });
}

function send(socket: Socket, text: string): void {
  socket.write(`${text}\r\n`);
}

export async function sendMail(mail: Mail): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = netConnect({ host: config.smtp.host, port: config.smtp.port }, () => {
      void (async () => {
        try {
          await readResponse(socket);
          const fromMatch = config.smtp.from.match(/<(.+)>/);
          const fromAddress = fromMatch !== null ? fromMatch[1] : config.smtp.from;
          send(socket, `MAIL FROM:<${fromAddress}>`);
          const mailFrom = await readResponse(socket);
          if (mailFrom.code !== 250) { socket.destroy(); resolve(false); return; }
          send(socket, `RCPT TO:<${mail.to}>`);
          const rcpt = await readResponse(socket);
          if (rcpt.code !== 250 && rcpt.code !== 251) { socket.destroy(); resolve(false); return; }
          send(socket, 'DATA');
          const data = await readResponse(socket);
          if (data.code !== 354) { socket.destroy(); resolve(false); return; }
          const headers = [
            `From: ${config.smtp.from}`,
            `To: ${mail.to}`,
            `Subject: ${mail.subject}`,
            'MIME-Version: 1.0',
            'Content-Type: text/plain; charset=utf-8',
            'Content-Transfer-Encoding: 8bit',
            '',
          ].join('\r\n');
          socket.write(`${dotStuff(headers)}\r\n`);
          socket.write(`${dotStuff(mail.textBody)}\r\n`);
          socket.write('.\r\n');
          const end = await readResponse(socket);
          send(socket, 'QUIT');
          socket.end();
          resolve(end.code === 250);
        } catch {
          socket.destroy();
          resolve(false);
        }
      })();
    });
    socket.once('error', () => resolve(false));
    socket.setTimeout(15000, () => { socket.destroy(); resolve(false); });
  });
}
