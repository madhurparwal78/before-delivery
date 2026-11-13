import type { DocumentStatus, LinkState, RecipientStatus } from '../../shared/types.ts';

export interface LinkStateInput {
  documentStatus: DocumentStatus;
  recipientStatus: RecipientStatus;
  linkActive: boolean;
  linkExpired: boolean;
  isTurn: boolean;
}

/** The one place that decides a signing link's state. */
export const linkState = (input: LinkStateInput): LinkState => {
  if (input.documentStatus === 'voided') return 'voided';
  if (input.documentStatus === 'declined') return 'declined';
  if (input.documentStatus === 'completed') return 'completed';
  if (input.documentStatus === 'sealing') return 'sealing';
  if (input.recipientStatus === 'signed') return 'signed_waiting';
  if (!input.linkActive || input.linkExpired || !input.isTurn) return 'expired';
  return 'your_turn';
};
