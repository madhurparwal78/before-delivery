import { config } from './config';
import { query } from './db';
import { sendLetter, smtpReachable, type Letter } from './smtp';
import { newId } from './util';

const deliver = (letter: Letter): Promise<void> =>
  sendLetter({ host: config.smtpHost, port: config.smtpPort, from: config.mailFrom }, letter);

const verificationLetter = (handle: string, email: string, token: string): Letter => ({
  to: email,
  subject: 'Verify your Ashlar account',
  text: `Hi ${handle},\n\nOpen this link to verify your email: ${config.appPublicUrl}/verify?token=${token}\n`,
});

const forkNoticeLetter = (payload: ForkNotice): Letter => ({
  to: payload.email,
  subject: `${payload.forker} forked your pen "${payload.title}"`,
  text:
    `${payload.forker} forked "${payload.title}" into a new pen.\n\n` +
    `See the fork: ${config.appPublicUrl}/pen/${payload.forkId}\n`,
});

export interface ForkNotice {
  email: string;
  forker: string;
  title: string;
  forkId: string;
}

/** Sign-up and resend send the verification letter directly, so the caller learns the outcome. */
export const sendVerification = async (
  handle: string,
  email: string,
  token: string,
): Promise<boolean> => {
  try {
    await deliver(verificationLetter(handle, email, token));
    return true;
  } catch {
    return false;
  }
};

/** A fork notice is queued, so it is sent exactly once even while mail is unreachable. */
export const queueForkNotice = async (notice: ForkNotice): Promise<void> => {
  await query('insert into outbox (id, kind, payload) values ($1, $2, $3)', [
    newId(),
    'fork_notice',
    JSON.stringify(notice),
  ]);
  void flushOutbox();
};

let flushing = false;

export const flushOutbox = async (): Promise<void> => {
  if (flushing) return;
  flushing = true;
  try {
    const rows = await query<{ id: string; payload: ForkNotice }>(
      `select id, payload from outbox
        where sent = false and next_attempt_at <= now() and kind = 'fork_notice'
        order by next_attempt_at asc limit 20`,
    );
    for (const row of rows) {
      try {
        await deliver(forkNoticeLetter(row.payload));
        await query('update outbox set sent = true, attempts = attempts + 1 where id = $1', [row.id]);
      } catch {
        await query(
          `update outbox set attempts = attempts + 1, next_attempt_at = now() + interval '10 seconds'
            where id = $1`,
          [row.id],
        );
      }
    }
  } finally {
    flushing = false;
  }
};

export const mailHealthy = (): Promise<boolean> => smtpReachable(config.smtpHost, config.smtpPort);
