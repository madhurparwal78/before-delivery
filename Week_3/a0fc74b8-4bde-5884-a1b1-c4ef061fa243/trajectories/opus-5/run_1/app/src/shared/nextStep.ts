import { ROW_WORD_HELD, ROW_WORD_SENT } from './copy.ts';
import type { Delivery, DocumentStatus, RecipientStatus } from './types.ts';

export interface NextStepInput {
  status: DocumentStatus;
  recipientCount: number;
  current: { name: string; order: number; status: RecipientStatus; delivery: Delivery | null } | null;
}

/** The one place that decides the Next step text. */
export const nextStepText = (input: NextStepInput): string => {
  switch (input.status) {
    case 'draft':
      return 'Add signers and fields';
    case 'sealing':
      return 'Sealing the completed PDF';
    case 'completed':
    case 'declined':
    case 'voided':
      return 'None';
    case 'in_progress': {
      const current = input.current;
      if (!current) return 'None';
      if (current.status === 'expired') return `Link expired for ${current.name}`;
      if (current.delivery === 'held') return `Invitation not delivered yet to ${current.name}`;
      return `Waiting for ${current.name} (${current.order} of ${input.recipientCount})`;
    }
  }
};

/** The one place that decides a signing-order row's status word. */
export const rowStatusWord = (status: RecipientStatus, delivery: Delivery | null): string => {
  if (status === 'invited' && delivery === 'held') return ROW_WORD_HELD;
  return ROW_WORD_SENT[status];
};
