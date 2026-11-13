import { createTransport } from 'nodemailer';
import { env } from './env.js';

const transport = createTransport({
  host: env.smtpHost,
  port: env.smtpPort,
  secure: false,
  ignoreTLS: true,
  connectionTimeout: 4000,
  greetingTimeout: 4000,
  socketTimeout: 6000,
});

/** A send counts only when the SMTP server accepts the message for delivery. */
export async function sendSignInLink(email: string, token: string): Promise<boolean> {
  const link = `${env.appPublicUrl}/auth/link/${token}`;
  try {
    await transport.sendMail({
      from: env.mailFrom,
      to: email,
      subject: 'Your Due Coin sign-in link',
      text: `Open this link to sign in: ${link}\n`,
    });
    return true;
  } catch {
    return false;
  }
}
