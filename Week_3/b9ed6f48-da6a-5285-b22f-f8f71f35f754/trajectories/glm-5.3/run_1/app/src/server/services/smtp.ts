import net from 'node:net';
import type { Config } from '../config.ts';

/** SMTP delivery to the mail service. */
/** A header value with non-ASCII characters becomes an RFC 2047 encoded word. */
function encodeHeader(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?utf-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

export class Smtp {
  constructor(private config: Config) {}

  send(toEmail: string, subject: string, body: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const socket = net.createConnection({ host: this.config.smtpHost, port: this.config.smtpPort });
      let buffer = '';
      let stage: 'greeting' | 'helo' | 'mail' | 'rcpt' | 'data' | 'body' | 'quit' = 'greeting';
      let failed = false;

      const fail = (err: Error): void => {
        if (failed) return;
        failed = true;
        socket.destroy();
        reject(err);
      };
      socket.setTimeout(20_000);
      socket.on('timeout', () => fail(new Error('smtp timeout')));
      socket.on('error', (err) => fail(err));

      socket.on('data', (chunk: Buffer | string) => {
        buffer += chunk.toString();
        for (;;) {
          const idx = buffer.indexOf('\r\n');
          if (idx === -1) return;
          const line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          if (line.length >= 4 && line[3] === '-') continue; // a continued reply line
          const code = line.slice(0, 3);
          switch (stage) {
            case 'greeting':
              if (!code.startsWith('2')) return void fail(new Error(`smtp greeting refused: ${line}`));
              stage = 'helo';
              socket.write('HELO sightline\r\n');
              return;
            case 'helo':
              if (!code.startsWith('2')) return void fail(new Error(`smtp helo refused: ${line}`));
              stage = 'mail';
              socket.write('MAIL FROM:<box-office@halden.test>\r\n');
              return;
            case 'mail':
              if (!code.startsWith('2')) return void fail(new Error(`smtp mail refused: ${line}`));
              stage = 'rcpt';
              socket.write(`RCPT TO:<${toEmail}>\r\n`);
              return;
            case 'rcpt':
              if (!code.startsWith('2')) return void fail(new Error(`smtp rcpt refused: ${line}`));
              stage = 'data';
              socket.write('DATA\r\n');
              return;
            case 'data': {
              if (!code.startsWith('3')) return void fail(new Error(`smtp data refused: ${line}`));
              stage = 'body';
              const headers = [
                `From: ${encodeHeader(this.config.mailFrom)}`,
                `To: ${toEmail}`,
                `Subject: ${encodeHeader(subject)}`,
                'MIME-Version: 1.0',
                'Content-Type: text/plain; charset=utf-8',
                'Content-Transfer-Encoding: 8bit',
                '',
                '',
              ].join('\r\n');
              const message = `${headers}${body}${body.endsWith('\r\n') ? '' : '\r\n'}`;
              socket.write(`${message.replace(/\r\n\./g, '\r\n..')}.\r\n`);
              return;
            }
            case 'body':
              if (!code.startsWith('2')) return void fail(new Error(`smtp body refused: ${line}`));
              stage = 'quit';
              socket.write('QUIT\r\n');
              return;
            case 'quit':
              socket.destroy();
              resolve();
              return;
          }
        }
      });
    });
  }
}
