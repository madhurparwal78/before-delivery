import nodemailer, { type Transporter } from "nodemailer";
import type { AppConfig } from "./config.js";

const UNREACHABLE_CACHE_MS = 5000; // DP-58

/** Wraps the post office: every request tries the mail server afresh, caching failures briefly. */
export class PostOffice {
  private transporter: Transporter | null = null;
  private downSince = 0;

  constructor(private readonly cfg: AppConfig) {}

  private ensure(): Transporter {
    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host: this.cfg.smtp.host,
        port: this.cfg.smtp.port,
        secure: false,
        ignoreTLS: true,
        connectionTimeout: 4000,
        greetingTimeout: 4000,
        socketTimeout: 8000,
      });
    }
    return this.transporter;
  }

  private isDown(): boolean {
    return this.downSince !== 0 && Date.now() - this.downSince < UNREACHABLE_CACHE_MS;
  }

  /** RFC 2047 UTF-8 encoded-word for a header value, ASCII-only on the wire. */
  private encodeHeader(value: string): string {
    if (/^[\x20-\x7e]*$/.test(value)) return value;
    return `=?utf-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
  }

  async isOpen(): Promise<boolean> {
    if (this.isDown()) return false;
    try {
      await this.ensure().verify();
      this.downSince = 0;
      return true;
    } catch {
      this.downSince = Date.now();
      this.transporter = null;
      return false;
    }
  }

  /** Postbox key email: the claim link once, and nothing derived from the return path. */
  async sendPostboxKey(to: string, claimLink: string): Promise<boolean> {
    return this.send({
      to,
      from: this.cfg.smtp.from,
      subject: "Your Parcel Moon postbox key",
      text: `Open this link to claim your Parcel Moon postbox:\n\n${claimLink}\n\nThe key works once and expires soon.`,
    });
  }

  /** Postcard email: exactly one recipient, encoded headers, no Reply-To/CC/Bcc. */
  async sendPostcard(to: string, displayName: string, shareUrl: string): Promise<boolean> {
    return this.send({
      to,
      from: { name: this.encodeHeader(`${displayName} via Parcel Moon`), address: "postcards@kitefold.example" },
      envelope: { from: "postcards@kitefold.example", to: [to] },
      subject: this.encodeHeader(`${displayName} sent you a postcard from Bramble`),
      text: `${displayName} took this postcard on Bramble: ${shareUrl}`,
    });
  }

  private async send(options: { to: string; from: string | { name: string; address: string }; subject: string; text: string; envelope?: { from: string; to: string[] } }): Promise<boolean> {
    if (this.isDown()) return false;
    try {
      await this.ensure().sendMail({
        from: options.from,
        to: options.to,
        subject: options.subject,
        text: options.text,
        envelope: options.envelope,
      });
      this.downSince = 0;
      return true;
    } catch {
      this.downSince = Date.now();
      this.transporter = null;
      return false;
    }
  }
}
