import * as net from 'node:net';

export interface MailConfig { host: string; port: number; from: string }

export interface MailResult { sent: boolean }

// Send one verification email through Mailpit's SMTP listener. Resolves false
// when Mailpit did not accept the message.
export function sendVerificationEmail(cfg: MailConfig, to: string, token: string, expiresAt: Date): Promise<MailResult> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: cfg.host, port: cfg.port });
    let stage: 'greeting' | 'helo' | 'mail' | 'rcpt' | 'data' | 'body' | 'quit' | 'done' = 'greeting';
    let done = false;

    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      try { socket.destroy(); } catch { /* socket already closed */ }
      resolve({ sent: ok });
    };

    socket.setTimeout(4000, () => finish(false));
    socket.on('error', () => finish(false));
    socket.on('close', () => finish(stage === 'done'));

    socket.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      const lines = text.split('\r\n').filter(Boolean);
      for (const line of lines) {
        const code = parseInt(line.slice(0, 3), 10);
        if (stage === 'greeting' && code === 220) {
          stage = 'helo';
          socket.write('HELO quarkyard\r\n');
        } else if (stage === 'helo' && code === 250) {
          stage = 'mail';
          socket.write(`MAIL FROM:<${extractAddress(cfg.from)}>\r\n`);
        } else if (stage === 'mail' && code === 250) {
          stage = 'rcpt';
          socket.write(`RCPT TO:<${to}>\r\n`);
        } else if (stage === 'rcpt' && code === 250) {
          stage = 'data';
          socket.write('DATA\r\n');
        } else if (stage === 'data' && code === 354) {
          stage = 'body';
          const body = [
            `From: ${cfg.from}`,
            `To: ${to}`,
            'Subject: Verify your Quarkyard email',
            'Content-Type: text/plain; charset=utf-8',
            '',
            `/verify?token=${token}`,
            `This link expires at ${expiresAt.toISOString()}.`,
            '',
          ].join('\r\n');
          socket.write(`${body}\r\n.\r\n`);
        } else if (stage === 'body' && code === 250) {
          stage = 'quit';
          socket.write('QUIT\r\n');
        } else if (stage === 'quit' && code === 221) {
          stage = 'done';
          finish(true);
        } else if (code >= 400) {
          finish(false);
        }
      }
    });
  });
}

function extractAddress(from: string): string {
  const m = /<([^>]+)>/.exec(from);
  return m ? m[1]! : from;
}
