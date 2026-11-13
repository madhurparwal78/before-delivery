import { config } from './config';
import { volumeMm3 } from '../shared/numbers';
import { sendMail } from './smtp';

export class MailUnavailable extends Error {}

async function send(to: string, subject: string, text: string): Promise<void> {
  try {
    await sendMail({
      host: config.smtp.host,
      port: config.smtp.port,
      from: config.smtp.from,
      to,
      subject,
      text,
    });
  } catch {
    throw new MailUnavailable();
  }
}

export async function sendVerificationMail(
  email: string,
  token: string,
  nextPath: string,
): Promise<void> {
  const link = `${config.publicUrl}/auth/verify?token=${token}&next=${encodeURIComponent(nextPath)}`;
  await send(
    email,
    'Confirm your Tinework account',
    `Confirm your Tinework account by opening this link:\n${link}\n`,
  );
}

export async function sendInvitationMail(
  email: string,
  partTitle: string,
  roomTitle: string,
  roomId: string,
  headLabel: string,
  headVolume: number,
): Promise<void> {
  const body = [
    `Room: ${roomTitle}`,
    `Revision: ${headLabel}`,
    `Head volume: ${volumeMm3(headVolume)}`,
    `${config.publicUrl}/rooms/${roomId}`,
  ].join('\n');
  await send(email, `Review ${partTitle} on Tinework`, `${body}\n`);
}
