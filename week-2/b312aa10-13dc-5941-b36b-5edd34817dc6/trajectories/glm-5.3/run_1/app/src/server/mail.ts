import type { Config } from './config.js';

export interface Mail {
  to: string;
  subject: string;
  body: string;
}

/** Encodes a header value per RFC 2047 when it contains non-ASCII characters. */
export function encodeHeader(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  const b64 = Buffer.from(value, 'utf8').toString('base64');
  const chunks = b64.match(/.{1,44}/g) ?? [];
  return chunks.map((c) => `=?utf-8?B?${c}?=`).join('\r\n ');
}

/** Sends one plain-text UTF-8 message with exactly one recipient. */
export async function sendMail(config: Config, mail: Mail): Promise<void> {
  const { createTransport } = await import('nodemailer');
  const transport = createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: false,
    tls: { rejectUnauthorized: false },
    ignoreTLS: true,
  });
  try {
    await transport.sendMail({
      from: config.mailFrom,
      to: mail.to,
      subject: mail.subject,
      text: mail.body,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  } finally {
    transport.close();
  }
}
