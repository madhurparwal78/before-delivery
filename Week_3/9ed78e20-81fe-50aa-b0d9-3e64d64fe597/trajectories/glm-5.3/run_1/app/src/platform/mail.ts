import net from 'node:net';
import { config } from '../config.js';

export type MailProbe = { up: boolean };

export let mailUp = false;
let lastProbe = 0;

export function mailStatus(): boolean {
  return mailUp;
}

export async function probeMail(): Promise<boolean> {
  lastProbe = Date.now();
  const ok = await smtpProbe();
  mailUp = ok;
  return ok;
}

export function mailProbeStale(now = Date.now()): boolean {
  return now - lastProbe > config.probeIntervalMs;
}

async function smtpProbe(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: config.smtp.host, port: config.smtp.port });
    const finish = (ok: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(3000, () => finish(false));
    socket.on('error', () => finish(false));
    socket.on('connect', () => {
      // The greeting alone proves the server is reachable.
      finish(true);
    });
  });
}

export type Address = { name: string; email: string };

export type MailSendResult =
  | { accepted: true }
  | { accepted: false; refused: boolean };

/**
 * Send one message over SMTP. Refused means the server permanently rejected the
 * message (5xx); anything else counts as unreachable so the job retries.
 */
export async function sendMail(
  options: { to: Address; subject: string; messageId: string; body: string },
): Promise<MailSendResult> {
  return new Promise<MailSendResult>((resolve) => {
    const socket = net.connect({ host: config.smtp.host, port: config.smtp.port });
    let stage = 0;
    let refused = false;
    let buffer = '';
    const timeout = setTimeout(() => {
      socket.destroy();
      resolve({ accepted: false, refused: false });
    }, 8000);

    const finish = (result: MailSendResult) => {
      clearTimeout(timeout);
      socket.removeAllListeners();
      try {
        socket.destroy();
      } catch {
        /* already closed */
      }
      resolve(result);
    };

    socket.on('error', () => {
      clearTimeout(timeout);
      finish({ accepted: false, refused: false });
    });
    socket.on('close', () => {
      clearTimeout(timeout);
      finish({ accepted: false, refused });
    });

    const send = (data: string) => socket.write(data + '\r\n');
    const readReply = () => {
      const lines = buffer.split('\r\n');
      let idx = 0;
      while (idx < lines.length - 1) idx += 1;
      const last = lines[lines.length - 2] ?? '';
      return last;
    };

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      // Wait for a complete final line (4xx/2xx code and space).
      const lines = buffer.split('\r\n');
      let last = '';
      for (const l of lines) if (l.length > 0) last = l;
      if (!/\d{3}[\s]|\d{3}$/.test(last.trim())) return;
      const code = last.slice(0, 3);
      const isFinal = last.length >= 4 && last[3] === ' ';
      if (!isFinal) {
        return;
      }
      buffer = '';
      if (stage === 0) {
        if (code[0] === '2') {
          send(`HELO aldermoor.example`);
          stage = 1;
        } else {
          refused = code[0] === '5';
          socket.end();
        }
      } else if (stage === 1) {
        if (code[0] === '2') {
          send(`MAIL FROM:${envelopeFrom()}`);
          stage = 2;
        } else {
          refused = code[0] === '5';
          socket.end();
        }
      } else if (stage === 2) {
        if (code[0] === '2') {
          send(`RCPT TO:<${options.to.email}>`);
          stage = 3;
        } else {
          refused = code[0] === '5';
          socket.end();
        }
      } else if (stage === 3) {
        if (code[0] === '2') {
          send(`DATA`);
          stage = 4;
        } else {
          refused = code[0] === '5';
          socket.end();
        }
      } else if (stage === 4) {
        if (code[0] === '3' || code[0] === '2') {
          const message = buildMessage(options);
          socket.write(message);
          send('.');
          stage = 5;
        } else {
          refused = code[0] === '5';
          socket.end();
        }
      } else if (stage === 5) {
        if (code[0] === '2') {
          send('QUIT');
          socket.end();
          finish({ accepted: true });
        } else {
          refused = code[0] === '5';
          socket.end();
        }
      }
    });
  });
}

function envelopeFrom(): string {
  const match = /<([^>]*)>\s*$/.exec(config.mailFrom);
  if (match) return `<${match[1]}>`;
  const bare = config.mailFrom.trim();
  return `<${bare}>`;
}

function encodeHeader(value: string): string {
  // RFC 2047 B-encoding for non-ASCII header text.
  const needs = /[^\x00-\x7F]/.test(value);
  if (!needs) return value;
  const b64 = Buffer.from(value, 'utf8').toString('base64');
  return `=?utf-8?b?${b64}?=`;
}

export function buildMessage(options: {
  to: Address;
  subject: string;
  messageId: string;
  body: string;
}): string {
  const lines: string[] = [];
  const from = /<([^>]*)>\s*$/.test(config.mailFrom) ? formatQuotedNameOrRaw(config.mailFrom) : config.mailFrom;
  lines.push(`From: ${from}`);
  lines.push(`To: ${formatAddress(options.to)}`);
  lines.push(`Subject: ${encodeHeader(options.subject)}`);
  lines.push(`Message-ID: <${options.messageId}>`);
  lines.push('MIME-Version: 1.0');
  lines.push(`Content-Type: text/plain; charset=utf-8`);
  lines.push('Content-Transfer-Encoding: 8bit');
  lines.push('');
  const encoded = Buffer.from(options.body, 'utf8').toString('utf8');
  lines.push(encoded.replace(/\r?\n/g, '\r\n'));
  lines.push('');
  return lines.join('\r\n');
}

function formatAddress(addr: Address): string {
  if (!addr.name) return `<${addr.email}>`;
  return `${formatQuotedName(addr.name)} <${addr.email}>`;
}

function formatQuotedName(name: string): string {
  const special = /[^\x21-\x39\x3B-\x7E]/.test(name) || /["(),:;<@[\]]/.test(name);
  const needsEncoding = /[^\x00-\x7F]/.test(name);
  if (needsEncoding) {
    // Encode whole display name, then quote if it contains specials.
    const encoded = encodeHeader(name);
    return special ? `"${encoded}"` : encoded;
  }
  return special ? `"${name.replace(/(["\\])/g, '\\$1')}"` : name;
}

function formatQuotedNameOrRaw(raw: string): string {
  const match = /^(.*)<([^>]*)>\s*$/.exec(raw.trim());
  if (match) {
    const name = match[1].trim();
    return `${formatQuotedName(name)} <${match[2]}>`;
  }
  return raw.trim();
}
