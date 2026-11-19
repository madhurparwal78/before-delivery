import { config } from './config.js';
import { sendOverSmtp } from './smtp.js';

/** True once Mailpit has accepted the message. */
async function send(to: string, subject: string, body: string): Promise<boolean> {
  try {
    await sendOverSmtp({
      host: config.smtpHost,
      port: config.smtpPort,
      from: config.mailFrom,
      to,
      subject,
      text: body
    });
    return true;
  } catch {
    return false;
  }
}

function minutesOf(seconds: number): number {
  return Math.ceil(seconds / 60);
}

export function sendConfirmationCode(email: string, code: string): Promise<boolean> {
  const minutes = minutesOf(config.confirmCodeSeconds);
  return send(
    email,
    `Your Twigline code is ${code}`,
    [
      'Welcome to Twigline.',
      '',
      `Your 6-digit confirmation code is ${code}.`,
      `It expires in ${minutes} minutes.`,
      '',
      `Enter it at ${config.publicUrl}/signup to open your outline.`
    ].join('\n')
  );
}

export function sendSignUpAttemptNotice(email: string): Promise<boolean> {
  return send(
    email,
    'Someone tried to sign up with your email',
    [
      'Someone tried to sign up to Twigline with your email address.',
      '',
      'Your outline is untouched. If it was you, sign in instead:',
      `${config.publicUrl}/signin`
    ].join('\n')
  );
}

export function sendInvitation(
  email: string,
  inviterName: string,
  bulletText: string,
  token: string
): Promise<boolean> {
  return send(
    email,
    `${inviterName} shared a branch with you: ${bulletText}`,
    [
      `${inviterName} shared the branch "${bulletText}" with you on Twigline.`,
      '',
      'Open it here:',
      `${config.publicUrl}/invite/${token}`,
      '',
      'You will only see that branch, and nothing else in their outline.'
    ].join('\n')
  );
}
