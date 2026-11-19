import type { AppServices } from './context';
import { buildInviteMail, type InvitePayload } from './outbox';

/**
 * The invite email path: recorded in the ledger first, then attempted once.
 * Returns true when mail accepted it, false when it is queued for retry.
 */
export async function enqueueInviteEmail(
  services: AppServices,
  payload: { email: string; name: string; workspaceName: string; token: string; inviterName: string },
): Promise<boolean> {
  const inviteUrl = `${services.config.publicUrl}/join/${payload.token}`;
  const ledgerKey = payload.token;
  const full: InvitePayload = {
    email: payload.email,
    name: payload.name,
    workspaceName: payload.workspaceName,
    inviteUrl,
    inviterName: payload.inviterName,
  };
  const built = buildInviteMail(services.config, full);
  return services.outbox.enqueueAndTry('invite', ledgerKey, full as unknown as Record<string, unknown>, () => built);
}
