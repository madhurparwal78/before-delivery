import { createRequire } from "node:module";
import { env } from "../../common/env";
const require = createRequire(import.meta.url);
const nodemailer = require("nodemailer") as typeof import("nodemailer");

export interface Mailer {
  send(to: string, subject: string, body: string): Promise<void>;
}

/**
 * Mail goes to Mailpit over its SMTP port. Each message is sent in one call,
 * and a failure surfaces as `mail_unavailable` at the route.
 */
export function makeMailer(): Mailer {
  const transport = nodemailer.createTransport({
    host: env.smtp.host,
    port: env.smtp.port,
    ignoreTLS: true,
    connectionTimeout: 3000,
    greetingTimeout: 3000,
    socketTimeout: 5000,
  } as never);
  return {
    async send(to: string, subject: string, body: string) {
      await transport.sendMail({
        from: env.smtp.from,
        to,
        subject,
        text: body,
      });
    },
  };
}
