/* Outgoing mail through the SMTP sink. A mail that fails to send never fails
   the request that caused it. Plain text, one recipient per mail. */
import nodemailer from 'nodemailer';
import type { AppConfig } from '../config.js';

export type MailKind = 'verification' | 'password-reset' | 'lockout' | 'statement' | 'report';

export class Mailer {
  constructor(private cfg: AppConfig, private transport: nodemailer.Transporter) {}

  private send(to: string, subject: string, text: string): void {
    void this.transport
      .sendMail({ from: this.cfg.smtp.from, to, subject, text })
      .catch(() => undefined); // a failed mail never fails its request
  }

  private link(path: string): string {
    return `${this.cfg.publicUrl}${path}`;
  }

  verification(to: string, token: string): void {
    this.send(to, 'Confirm your Moothall email', `Welcome to Moothall.

Confirm your email address by opening this link:

${this.link(`/verify?token=${token}`)}

If you didn't create this account, ignore this mail.`);
  }

  passwordReset(to: string, token: string): void {
    this.send(to, 'Reset your Moothall password', `Reset your Moothall password by opening this link:

${this.link(`/reset?token=${token}`)}

The link expires soon. If you didn't ask for this, ignore this mail.`);
  }

  lockout(to: string): void {
    this.send(to, 'Sign-in attempts on your Moothall account', `Your account was locked after repeated failed sign-ins.

You can reset your password at ${this.link('/forgot')}.`);
  }

  statement(to: string, communityName: string, postTitle: string, publicReason: string, postUrl: string): void {
    this.send(to, `Your post in c/${communityName} was removed`, `Your post in c/${communityName} was removed by moderators.

Post title: ${postTitle}
Reason: ${publicReason}
This removal was made by the moderators of c/${communityName}.

View the post: ${this.link(postUrl)}

If you think this was a mistake, contact the moderators of c/${communityName}.`);
  }

  report(to: string, reference: string): void {
    this.send(to, `Report received: ${reference}`, `Report received: ${reference}

We will review your report.`);
  }
}
