import { SMTPClient } from 'emailjs';

const host = process.env.SMTP_HOST ?? '';
const port = Number(process.env.SMTP_PORT ?? '25');
export const mailFrom = process.env.MAIL_FROM ?? 'Keelson <keelson@tideline.test>';

const client = new SMTPClient({ host, port });

export async function sendMail(to: string, subject: string, body: string): Promise<void> {
  await client.sendAsync({
    from: mailFrom,
    to,
    subject,
    text: body,
  });
}
