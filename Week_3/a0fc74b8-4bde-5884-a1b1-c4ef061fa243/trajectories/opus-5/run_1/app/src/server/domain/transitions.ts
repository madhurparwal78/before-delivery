import type { DocumentStatus, RecipientStatus } from '../../shared/types.ts';

/** The one place that lists the allowed document transitions. */
const DOCUMENT_TRANSITIONS: ReadonlyArray<readonly [DocumentStatus, DocumentStatus]> = [
  ['draft', 'in_progress'],
  ['in_progress', 'sealing'],
  ['sealing', 'completed'],
  ['in_progress', 'declined'],
  ['in_progress', 'voided'],
];

/** The one place that lists the allowed recipient transitions. */
const RECIPIENT_TRANSITIONS: ReadonlyArray<readonly [RecipientStatus, RecipientStatus]> = [
  ['waiting', 'invited'],
  ['invited', 'viewed'],
  ['invited', 'signed'],
  ['viewed', 'signed'],
  ['invited', 'declined'],
  ['viewed', 'declined'],
  ['invited', 'expired'],
  ['viewed', 'expired'],
  ['expired', 'invited'],
];

export const canDocumentMove = (from: DocumentStatus, to: DocumentStatus): boolean =>
  DOCUMENT_TRANSITIONS.some(([a, b]) => a === from && b === to);

export const canRecipientMove = (from: RecipientStatus, to: RecipientStatus): boolean =>
  RECIPIENT_TRANSITIONS.some(([a, b]) => a === from && b === to);
