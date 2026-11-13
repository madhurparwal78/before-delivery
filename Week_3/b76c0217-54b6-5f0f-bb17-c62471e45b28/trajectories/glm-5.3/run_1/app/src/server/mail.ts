import * as nodemailer from 'nodemailer';
import { config } from '../config';

let mailOutageUntil = 0;
export function setMailOutage(ms: number): void { mailOutageUntil = Date.now() + ms; }
export function mailOut(): boolean { return Date.now() < mailOutageUntil; }

let transport: ReturnType<typeof nodemailer.createTransport> | null = null;

function getTransport() {
  if (!transport) {
    transport = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: false,
      tls: { rejectUnauthorized: false },
      connectionTimeout: 4000,
      greetingTimeout: 4000,
      socketTimeout: 8000,
    });
  }
  return transport;
}

export async function sendInviteMail(to: string, subject: string, body: string): Promise<void> {
  if (mailOut()) throw new Error('mail unavailable');
  await getTransport().sendMail({
    from: config.mailFrom,
    to,
    subject,
    text: body,
  });
}

export function inviteSubject(inviterName: string, teamName: string): string {
  return `${inviterName} invited you to ${teamName} on Galley`;
}

export function inviteBody(token: string): string {
  return `Join the team: ${config.appPublicUrl}/invite/${token}`;
}
