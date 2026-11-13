import nodemailer from "nodemailer";
import { config } from "./config";

const transport = nodemailer.createTransport({
  host: config.smtpHost,
  port: config.smtpPort,
  secure: false,
  ignoreTLS: true,
  connectionTimeout: 3000,
  greetingTimeout: 3000,
  socketTimeout: 8000,
});

/** Hands one plain-text message to the SMTP server; resolves only when the server accepted it. */
export async function sendMail(to: string, subject: string, text: string): Promise<void> {
  await transport.sendMail({ from: config.mailFrom, to, subject, text });
}
