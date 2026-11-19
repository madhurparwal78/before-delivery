// A tiny SMTP client for the sign-in link email. Mailpit speaks plain SMTP.
import { connect as tcpConnect, type Socket } from 'node:net';

export interface MailMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
}

/** Sends one email. Resolves true when the server accepted the message. */
export function sendMail(host: string, port: number, msg: MailMessage, timeoutMs = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok: boolean): void => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(ok);
    };
    const socket: Socket = tcpConnect({ host, port });
    socket.setTimeout(timeoutMs);
    let stage = 0;
    let buffer = '';
    const fromHeader = extractAddress(msg.from);
    const toHeader = extractAddress(msg.to);

    const commands: { send: string; expect: number }[] = [
      { send: `HELO kerbline\r\n`, expect: 250 },
      { send: `MAIL FROM:<${fromHeader}>\r\n`, expect: 250 },
      { send: `RCPT TO:<${toHeader}>\r\n`, expect: 250 },
      { send: `DATA\r\n`, expect: 354 }
    ];
    const body =
      `From: ${msg.from}\r\n` +
      `To: ${msg.to}\r\n` +
      `Subject: ${msg.subject}\r\n` +
      `Content-Type: text/plain; charset=utf-8\r\n` +
      `\r\n` +
      msg.text;

    const onLine = (line: string): void => {
      if (stage === 0) {
        if (!line.startsWith('220')) { finish(false); return; }
        stage = 1;
        socket.write(commands[0].send);
        return;
      }
      if (stage <= commands.length) {
        const cmd = commands[stage - 1];
        if (!line.startsWith(String(cmd.expect))) { finish(false); return; }
        if (stage === commands.length) {
          socket.write(body.replace(/\r?\n\./g, '\n..') + '\r\n.\r\n');
          stage = commands.length + 1;
          return;
        }
        stage++;
        socket.write(commands[stage - 1].send);
      } else if (stage === commands.length + 1) {
        finish(line.startsWith('250'));
      }
    };

    socket.on('data', (data: Buffer) => {
      buffer += data.toString('utf-8');
      let idx: number;
      while ((idx = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        onLine(line);
        if (done) return;
      }
    });
    socket.on('timeout', () => finish(false));
    socket.on('error', () => finish(false));
    socket.on('close', () => finish(false));
  });
}

function extractAddress(header: string): string {
  const m = header.match(/<([^>]+)>/);
  return m ? m[1] : header.trim();
}
