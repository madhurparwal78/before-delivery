import net from 'node:net';

/**
 * A minimal SMTP client for the two kinds of email Marginalia sends.
 * Each send opens a fresh connection, so no failure is remembered.
 */

export interface SmtpConfig {
  host: string;
  port: number;
  from: string;
  connectionTimeoutMs?: number;
}

/** Encode a header value so no supplied text can start a new header line. */
function encodeHeader(value: string): string {
  const safe = value.replace(/[\r\n\t\f\v\u0000-\u001f\u007f-\u009f]+/g, ' ').trim();
  const needsEncoding = /[^\x20-\x7e]/.test(safe) || /^=\?/m.test(safe);
  if (!needsEncoding) return safe;
  // RFC 2047 encoded-word with UTF-8 base64.
  const b64 = Buffer.from(safe, 'utf8').toString('base64');
  const words: string[] = [];
  for (let i = 0; i < b64.length; i += 40) {
    words.push(`=?utf-8?B?${b64.slice(i, i + 40)}?=`);
  }
  return words.join('\r\n ');
}

/** Escape a dot-leading line per RFC 5321 dot-stuffing. */
function dotStuff(body: string): string {
  return body.replace(/(^|\r\n)\./g, '$1..');
}

export async function smtpSend(
  cfg: SmtpConfig,
  to: string,
  subject: string,
  body: string,
): Promise<boolean> {
  const timeout = cfg.connectionTimeoutMs ?? 8000;
  return new Promise<boolean>((resolve) => {
    const socket = net.createConnection({ host: cfg.host, port: cfg.port });
    socket.setTimeout(timeout);
    let buffer = '';
    let stage = 0;
    const fail = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.on('error', () => fail(false));
    socket.on('timeout', () => fail(false));
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      if (!/\r\n$/.test(buffer)) return;
      const code = Number.parseInt(buffer.slice(0, 3), 10);
      buffer = '';
      stage += 1;
      if (stage === 1) {
        if (code !== 220) return fail(false);
        socket.write(`HELO marginalia\r\n`);
        return;
      }
      if (stage === 2) {
        if (code !== 250) return fail(false);
        const fromAddr = extractAddress(cfg.from);
        socket.write(`MAIL FROM:<${fromAddr}>\r\n`);
        return;
      }
      if (stage === 3) {
        if (code !== 250) return fail(false);
        socket.write(`RCPT TO:<${to}>\r\n`);
        return;
      }
      if (stage === 4) {
        if (code !== 250 && code !== 251) return fail(false);
        socket.write(`DATA\r\n`);
        return;
      }
      if (stage === 5) {
        if (code !== 354) return fail(false);
        const fromLine = /<[^>]*>/.test(cfg.from) ? cfg.from : cfg.from;
        const message = [
          `From: ${encodeHeader(fromLine)}`,
          `To: ${to}`,
          `Subject: ${encodeHeader(subject)}`,
          `MIME-Version: 1.0`,
          `Content-Type: text/plain; charset=utf-8`,
          `Content-Transfer-Encoding: 8bit`,
          `Date: ${new Date().toUTCString()}`,
          ``,
          dotStuff(body.replace(/\r\n/g, '\r\n')),
        ].join('\r\n');
        socket.write(message);
        socket.write('\r\n.\r\n');
        return;
      }
      if (stage === 6) {
        socket.write(`QUIT\r\n`);
        return fail(code === 250);
      }
    });
    socket.on('close', () => {
      if (stage < 7) resolve(false);
    });
  });
}

function extractAddress(from: string): string {
  const m = /<([^>]*)>/.exec(from);
  return m ? m[1] : from.replace(/.*\s/, '');
}
