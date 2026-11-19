import { AppConfig } from "./config.js";
import { createTransport, Transporter } from "nodemailer";

/**
 * The SMTP side of the mail queue. Messages are fully rendered when the queue
 * row is created; delivery sends those stored bytes unchanged (DP: Business
 * rules/Mail queue).
 */
export class SmtpUnreachable extends Error {
  constructor(public readonly detail: string) {
    super(`SMTP unreachable: ${detail}`);
  }
}

export class Mailer {
  private transporter: Transporter | null = null;

  constructor(private readonly config: AppConfig) {}

  private transport(): Transporter {
    if (!this.transporter) {
      this.transporter = createTransport({
        host: this.config.smtp.host,
        port: this.config.smtp.port,
        secure: false,
        connectionTimeout: 5000,
        greetingTimeout: 5000,
        socketTimeout: 10000,
        tls: { rejectUnauthorized: false },
      });
    }
    return this.transporter;
  }

  async verify(): Promise<boolean> {
    try {
      await this.transport().verify();
      return true;
    } catch {
      return false;
    }
  }

  async send(raw: string, envelopeFrom: string): Promise<void> {
    const parsed = this.parseRaw(raw);
    const mailer = this.transport();
    await new Promise<void>((resolve, reject) => {
      mailer.sendMail(
        {
          envelope: { from: envelopeFrom, to: [parsed.to] },
          from: parsed.from,
          to: parsed.to,
          replyTo: parsed.replyTo,
          subject: parsed.subject,
          text: parsed.text,
        },
        (error) => {
          if (error) reject(new SmtpUnreachable(error.message));
          else resolve();
        },
      );
    });
  }

  private parseRaw(raw: string): {
    from: string;
    to: string;
    replyTo: string | undefined;
    subject: string;
    text: string;
  } {
    // The rendered message is RFC 5322 text; take the pieces nodemailer needs.
    const lines = raw.split(/\r?\n/);
    const headers = new Map<string, string>();
    let index = 0;
    while (index < lines.length && lines[index].trim() !== "") {
      const line = lines[index];
      const colon = line.indexOf(":");
      if (colon > 0) {
        headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
      }
      index += 1;
    }
    const body = lines.slice(index + 1).join("\r\n");
    return {
      from: headers.get("from") || this.config.smtp.from,
      to: headers.get("to") || "",
      replyTo: headers.get("reply-to"),
      subject: this.decodeHeaderValue(headers.get("subject") || ""),
      text: body,
    };
  }

  private decodeHeaderValue(value: string): string {
    return value
      .split(/\s+/)
      .map((word) => {
        const match = /^=\?([^?]+)\?([BbQq])\?([^?]*)\?=$/.exec(word);
        if (!match) return word;
        const [, charset, encoding, payload] = match;
        if (encoding.toLowerCase() === "b") {
          return Buffer.from(payload, "base64").toString(charset as BufferEncoding);
        }
        return payload.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) =>
          Buffer.from(hex, "hex").toString(charset as BufferEncoding),
        );
      })
      .join(" ");
  }
}

/**
 * The single place that builds a To/Reply-To header value (DP-46). The address
 * is a validated bare address, so it can never add recipients or headers.
 */
export function displayAddress(name: string, address: string): string {
  const trimmed = name.trim();
  if (!/^[\x00-\x7F]+$/.test(trimmed)) {
    // Non-ASCII display names travel as RFC 2047 encoded words so Mailpit
    // decodes them exactly as typed.
    return `=?utf-8?b?${Buffer.from(trimmed, "utf-8").toString("base64")}?= <${address}>`;
  }
  const safeUnquoted = /^[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~ ]+$/.test(trimmed);
  if (safeUnquoted) {
    return `${trimmed} <${address}>`;
  }
  return `"${trimmed.replace(/(["\\])/g, "\\$1")}" <${address}>`;
}
