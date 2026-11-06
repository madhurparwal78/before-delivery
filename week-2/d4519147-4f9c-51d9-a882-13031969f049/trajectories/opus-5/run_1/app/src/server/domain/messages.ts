import { config } from '../config';
import type { OutboundMessage } from '../services/mail';

export const INVITATION_SUBJECT = 'You have been invited to a diagram on Scopewright';
export const ACCESS_CHANGED_SUBJECT = 'Your access to a diagram on Scopewright changed';

/** `YYYY-MM-DDTHH:MM:SSZ` */
export function utcStamp(at: Date): string {
  return `${at.toISOString().slice(0, 19)}Z`;
}

export function invitationMessage(options: {
  to: string;
  inviterName: string;
  diagramTitle: string;
  role: 'editor' | 'viewer';
  token: string;
  expiresAt: Date;
}): OutboundMessage {
  const body = [
    `${options.inviterName} invited you to ${options.diagramTitle} as ${options.role}.`,
    `Accept: ${config.publicUrl}/invite/${options.token}`,
    `This link expires at ${utcStamp(options.expiresAt)} (UTC).`,
    '',
  ].join('\n');
  return { to: options.to, subject: INVITATION_SUBJECT, body };
}

export function accessChangedMessage(options: {
  to: string;
  diagramTitle: string;
  change: 'downgraded' | 'revoked';
}): OutboundMessage {
  const line =
    options.change === 'downgraded'
      ? `Your role on ${options.diagramTitle} is now viewer.`
      : `You no longer have access to ${options.diagramTitle}.`;
  return { to: options.to, subject: ACCESS_CHANGED_SUBJECT, body: `${line}\n` };
}
