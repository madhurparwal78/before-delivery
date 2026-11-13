import { inviteBody } from '../api/team';
import { config } from '../config';
import { heldInvites, markInviteSent, teamById, userById } from '../db/accounts';
import { messages } from '../domain/messages';
import { emitInvite } from './events';
import { MailUnavailable, sendMail } from './mail';

/** A held invite is retried every MAIL_RETRY_MS until the mail server accepts it. */
async function retryOnce(): Promise<void> {
  for (const invite of await heldInvites()) {
    const [team, inviter] = await Promise.all([teamById(invite.teamId), userById(invite.invitedBy)]);
    if (team === null || inviter === null) continue;
    try {
      await sendMail({
        to: invite.email,
        subject: messages.inviteSubject(inviter.name, team.name),
        text: `${inviter.name} invited you to join ${team.name} on Galley.\n\nOpen this link to join:\n${config.appPublicUrl}/invite/${invite.token}\n`,
      });
    } catch (error) {
      if (error instanceof MailUnavailable) continue;
      throw error;
    }
    const sent = await markInviteSent(invite.id);
    emitInvite(invite.teamId, inviteBody(sent));
  }
}

export function startMailRetries(): void {
  let running = false;
  setInterval(() => {
    if (running) return;
    running = true;
    void retryOnce().finally(() => {
      running = false;
    });
  }, config.mailRetryMs).unref();
}
