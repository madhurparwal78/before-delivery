import { createConnection, type Socket } from 'node:net';

// Mailpit delivers the confirmation and password-reset messages over SMTP.
// Every message comes from MAIL_FROM and goes to the player's email. A token
// is valid only after Mailpit has accepted its message; when Mailpit cannot
// be reached, nothing counts as sent and the health check lists "mailpit".

export interface MailService {
  send(to: string, subject: string, body: string): Promise<boolean>;
  healthy(): Promise<boolean>;
  close(): Promise<void>;
}

export interface MailOptions {
  host: string;
  port: number;
  mailFrom: string;
}

export function createMail(options: MailOptions): MailService {
  let down = false;

  async function send(to: string, subject: string, body: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let socket: Socket;
      try {
        socket = createConnection({ host: options.host, port: options.port });
      } catch {
        down = true;
        resolve(false);
        return;
      }
      let stage = 0;
      let buffer = '';
      const fail = () => {
        if (!down) down = true;
        socket.destroy();
        resolve(false);
      };
      socket.setTimeout(5000, fail);
      socket.on('error', fail);
      socket.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        if (!buffer.endsWith('\r\n')) return;
        const lines = buffer.split('\r\n').filter((l) => l.length > 0);
        buffer = '';
        const last = lines[lines.length - 1];
        const code = Number(last.slice(0, 3));
        if (code >= 500) {
          fail();
          return;
        }
        stage++;
        switch (stage) {
          case 1:
            socket.write(`EHLO seam\r\n`);
            break;
          case 2:
            socket.write(`MAIL FROM:<${extractAddress(options.mailFrom)}>\r\n`);
            break;
          case 3:
            socket.write(`RCPT TO:<${to}>\r\n`);
            break;
          case 4:
            socket.write(`DATA\r\n`);
            break;
          case 5:
            socket.write(buildMessage(options.mailFrom, to, subject, body));
            break;
          case 6:
            socket.write(`QUIT\r\n`);
            down = false;
            socket.end();
            resolve(true);
            break;
        }
      });
    });
  }

  return {
    send,
    async healthy(): Promise<boolean> {
      // The health check reports reachability without sending a message.
      return new Promise<boolean>((resolve) => {
        let socket: Socket;
        try {
          socket = createConnection({ host: options.host, port: options.port });
        } catch {
          resolve(false);
          return;
        }
        let answered = false;
        socket.setTimeout(3000, () => {
          if (!answered) {
            socket.destroy();
            down = true;
            resolve(false);
          }
        });
        socket.on('error', () => {
          if (!answered) {
            answered = true;
            down = true;
            resolve(false);
          }
        });
        socket.on('data', () => {
          if (answered) return;
          answered = true;
          down = false;
          socket.destroy();
          resolve(true);
        });
      });
    },
    async close(): Promise<void> {
      void down;
    },
  };
}

function extractAddress(from: string): string {
  const m = /<([^>]+)>/.exec(from);
  return m ? m[1] : from;
}

function buildMessage(from: string, to: string, subject: string, body: string): string {
  const escaped = body.replace(/\r\n/g, '\n').replace(/^\./gm, '..');
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Content-Type: text/plain; charset=UTF-8`,
    ``,
    escaped,
    `.`,
    ``,
  ].join('\r\n');
}
