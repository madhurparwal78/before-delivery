import nodemailer, { type Transporter } from 'nodemailer'
import type { Config } from './config.js'

export class Mailer {
  private transporter: Transporter

  constructor(private cfg: Config) {
    this.transporter = nodemailer.createTransport({
      host: cfg.smtp.host,
      port: cfg.smtp.port,
      secure: false,
      tls: { rejectUnauthorized: false },
      connectionTimeout: 5000,
      socketTimeout: 5000,
    })
  }

  /** Send one email; resolves only once the sink accepts it. */
  async send(opts: { to: string[]; subject: string; bodyLines: string[] }): Promise<void> {
    await this.transporter.sendMail({
      from: this.cfg.smtp.from,
      to: opts.to,
      subject: opts.subject,
      text: opts.bodyLines.join('\n') + '\n',
    })
  }
}
