import { config } from '../config';
import { sendMail } from './smtp';

export async function deliverEmail(message: {
  to: string;
  subject: string;
  body: string;
}): Promise<void> {
  await sendMail(config.smtp.host, config.smtp.port, {
    from: config.smtp.from,
    to: message.to,
    subject: message.subject,
    body: message.body,
  });
}
