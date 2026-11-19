import { config } from './config';
import { buildMessage, sendMail } from './smtp';

async function send(to: string, subject: string, body: string): Promise<void> {
  try {
    await sendMail({
      host: config.mail.host,
      port: config.mail.port,
      from: config.mail.from,
      to,
      message: buildMessage(config.mail.from, to, subject, body),
    });
  } catch {
    /* the sink may be down: the account, code and invitation still exist */
  }
}

export async function sendSignupCode(email: string, code: string): Promise<void> {
  await send(email, 'Your Jarful code', `Your code is ${code}\n`);
}

export async function sendInvitation(
  email: string,
  inviterName: string,
  projectName: string,
  role: 'editor' | 'reader',
): Promise<void> {
  await send(
    email,
    `You're invited to ${projectName} on Jarful`,
    `${inviterName} invited you to ${projectName} as ${role}.\n\nAccept it here: ${config.appPublicUrl}/invites\n`,
  );
}
