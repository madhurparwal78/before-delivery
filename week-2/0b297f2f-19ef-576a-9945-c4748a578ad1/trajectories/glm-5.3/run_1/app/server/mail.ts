import net from 'node:net';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Tests whether the SMTP relay accepts connections. */
export function smtpReachable(host: string, port: number, timeoutMs = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const done = (ok: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.once('data', () => done(true));
  });
}

const CRLF = '\r\n';

/** Sends one message with a plain-text and an HTML part. */
export function sendMail(
  cfg: { host: string; port: number; from: string },
  message: MailMessage
): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: cfg.host, port: cfg.port });
    socket.setTimeout(10_000);
    const fail = (err: Error) => {
      socket.destroy();
      reject(err);
    };
    const boundary = `hangline-${Date.now().toString(36)}`;
    const fromAddress = cfg.from.match(/<(.+)>/)?.[1] ?? cfg.from;
    const headers = [
      `From: ${cfg.from}`,
      `To: ${message.to}`,
      `Subject: ${message.subject}`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ].join(CRLF);
    const body = [
      `--${boundary}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      message.text,
      `--${boundary}`,
      'Content-Type: text/html; charset=utf-8',
      '',
      message.html,
      `--${boundary}--`,
      '',
    ].join(CRLF);

    let stepIndex = 0;
    let pending = '';

    const steps: Array<{ send: string }> = [
      { send: `EHLO hangline.local${CRLF}` },
      { send: `MAIL FROM:<${fromAddress}>${CRLF}` },
      { send: `RCPT TO:<${message.to}>${CRLF}` },
      { send: `DATA${CRLF}` },
      { send: `${headers}${CRLF}${CRLF}${body.replace(/^\./gm, '..')}${CRLF}.${CRLF}` },
      { send: `QUIT${CRLF}` },
    ];

    socket.on('error', fail);
    socket.on('timeout', () => fail(new Error('SMTP timeout')));
    socket.on('data', (chunk: Buffer) => {
      pending += chunk.toString('utf8');
      const lines = pending.split(CRLF);
      if (lines.length < 2) return;
      const last = lines[lines.length - 2] ?? '';
      const code = Number(last.slice(0, 3));
      if (!Number.isFinite(code)) return;
      const isFinal = last.length < 4 || last[3] !== '-';
      if (!isFinal) return;
      pending = '';
      if (code >= 500) {
        fail(new Error(`SMTP refused with ${code}`));
        return;
      }
      const step = steps[stepIndex];
      if (step === undefined) {
        socket.end();
        return;
      }
      stepIndex += 1;
      socket.write(step.send);
      if (stepIndex === steps.length) {
        socket.once('close', () => resolve());
      }
    });
  });
}

