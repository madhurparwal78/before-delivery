import net from 'node:net';
import type { Env } from '../env.ts';

/**
 * The outgoing mail service — a small SMTP client for the house relay
 * (Mailpit). One connection per message keeps the health probe honest.
 */
export interface MailService {
  send(to: string, subject: string, text: string, html: string): Promise<void>;
  health(): Promise<boolean>;
}

export function createMail(env: Env): MailService {
  const connect = (): Promise<net.Socket> =>
    new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: env.mail.host, port: env.mail.port });
      socket.setTimeout(4000);
      socket.once('connect', () => {
        socket.setTimeout(0);
        resolve(socket);
      });
      socket.once('error', (err) => {
        socket.destroy();
        reject(err);
      });
      socket.once('timeout', () => {
        socket.destroy();
        reject(new Error('SMTP connect timeout'));
      });
    });

  const read = (socket: net.Socket): Promise<string> =>
    new Promise((resolve, reject) => {
      let buffer = '';
      const cleanup = (): void => {
        socket.off('data', onData);
        socket.off('error', onErr);
        socket.off('timeout', onTimeout);
      };
      const onData = (chunk: Buffer): void => {
        buffer += chunk.toString('utf8');
        // an SMTP reply is complete when its final line ends with a space
        // in the fourth position; multi-line replies continue with a hyphen
        const lines = buffer.split('\r\n');
        const lastComplete = lines.length >= 2 ? lines[lines.length - 2] : '';
        if (lastComplete.length >= 4 && lastComplete[3] === ' ') {
          cleanup();
          resolve(buffer);
        }
      };
      const onErr = (err: Error): void => {
        cleanup();
        reject(err);
      };
      const onTimeout = (): void => {
        cleanup();
        socket.destroy();
        reject(new Error('SMTP reply timeout'));
      };
      socket.on('data', onData);
      socket.once('error', onErr);
      socket.once('timeout', onTimeout);
    });

  const command = async (socket: net.Socket, line: string): Promise<string> => {
    socket.write(`${line}\r\n`);
    return read(socket);
  };

  const withDeadline = async <T>(work: () => Promise<T>): Promise<T> => {
    let timer: NodeJS.Timeout | null = null;
    try {
      return await Promise.race([
        work(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('SMTP deadline')), 10_000);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  return {
    async send(to: string, subject: string, text: string, html: string): Promise<void> {
      void html;
      await withDeadline(async () => {
      const socket = await connect();
      try {
        await read(socket); // server greeting
        await command(socket, 'EHLO lacquer.marrowlark.test');
        await command(socket, `MAIL FROM:<${envelopeFrom(env.mail.from)}>`);
        await command(socket, `RCPT TO:<${to}>`);
        await command(socket, 'DATA');
        const message = [
          `From: ${env.mail.from}`,
          `To: ${to}`,
          `Subject: ${subject}`,
          'MIME-Version: 1.0',
          'Content-Type: text/plain; charset=utf-8',
          '',
          text.replace(/^\./gm, '..'),
        ].join('\r\n');
        socket.write(`${message}\r\n.\r\n`);
        await read(socket); // message accepted
        await command(socket, 'QUIT');
      } finally {
        socket.destroy();
      }
      });
    },
    async health(): Promise<boolean> {
      try {
        const socket = await connect();
        try {
          await read(socket);
          return true;
        } finally {
          socket.destroy();
        }
      } catch {
        return false;
      }
    },
  };
}

function envelopeFrom(fromLine: string): string {
  const match = /<([^>]+)>/.exec(fromLine);
  return match?.[1] ?? fromLine;
}
