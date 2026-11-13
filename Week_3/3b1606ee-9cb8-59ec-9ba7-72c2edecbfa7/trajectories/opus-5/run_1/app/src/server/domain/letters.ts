import type { LetterClass, LetterRecord, LetterState } from '../../shared/types.js';
import { iso } from '../clock.js';
import { canRetract } from './retract.js';

export interface LetterRow {
  id: string;
  seq: string;
  conversation_id: string;
  sender_id: string;
  recipient_id: string;
  letter_class: LetterClass;
  state: LetterState;
  failure: 'returned' | null;
  held_at: Date;
  delivered_at: Date | null;
  read_at: Date | null;
  returned_at: Date | null;
  retracted_at: Date | null;
  sender_key_id: string;
  recipient_key_id: string;
  iv: string | null;
  ciphertext: string | null;
  attachment_id: string | null;
  dropped: boolean;
}

const LETTER_FIELDS = [
  'id',
  'seq',
  'conversation_id',
  'sender_id',
  'recipient_id',
  'letter_class',
  'state',
  'failure',
  'held_at',
  'delivered_at',
  'read_at',
  'returned_at',
  'retracted_at',
  'sender_key_id',
  'recipient_key_id',
  'iv',
  'ciphertext',
  'attachment_id',
  'dropped',
];

export const LETTER_COLUMNS = LETTER_FIELDS.join(', ');

export function letterColumns(alias: string): string {
  return LETTER_FIELDS.map((field) => `${alias}.${field}`).join(', ');
}

/** The sealed body travels only to the recipient, and only while the letter is held. */
function sealedForViewer(row: LetterRow, viewerId: string): boolean {
  return (
    row.recipient_id === viewerId &&
    row.state === 'sent' &&
    row.retracted_at === null &&
    !row.dropped
  );
}

export function letterRecord(row: LetterRow, viewerId: string, now: Date): LetterRecord {
  const sealed = sealedForViewer(row, viewerId);
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    seq: Number(row.seq),
    sender_id: row.sender_id,
    recipient_id: row.recipient_id,
    class: row.letter_class,
    state: row.state,
    failure: row.failure,
    held_at: row.held_at.toISOString(),
    delivered_at: iso(row.delivered_at),
    read_at: iso(row.read_at),
    returned_at: iso(row.returned_at),
    retracted_at: iso(row.retracted_at),
    can_retract: canRetract(row, viewerId, now),
    sender_key_id: row.sender_key_id,
    recipient_key_id: row.recipient_key_id,
    iv: sealed ? row.iv : null,
    ciphertext: sealed ? row.ciphertext : null,
    attachment_id: row.attachment_id,
  };
}
