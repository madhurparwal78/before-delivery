import type { Conversation } from '../../shared/types';
import { firstLine } from '../lib/format';
import type { LocalLetter } from '../types';

type Delivery = 'sending' | 'sent' | 'delivered' | 'read' | 'failed';

interface PostmarkView {
  label: string;
  time: string | null;
  delivery: Delivery;
}

/** The postmark a letter carries: its label (the brief's table), its server time, and its `data-delivery`. */
export function postmarkOf(letter: LocalLetter): PostmarkView {
  if (letter.direction === 'received') {
    const state = letter.state === 'read' ? 'read' : letter.state === 'sent' ? 'sent' : 'delivered';
    return { label: 'Received', time: letter.heldAt, delivery: state };
  }
  if (letter.phase === 'queued' || letter.phase === 'uploading') return { label: 'Sending', time: null, delivery: 'sending' };
  if (letter.phase === 'upload_failed' || letter.phase === 'refused') return { label: 'Failed', time: null, delivery: 'failed' };
  if (letter.state === 'read') return { label: 'Read', time: letter.readAt, delivery: 'read' };
  if (letter.state === 'delivered') return { label: 'Delivered', time: letter.deliveredAt, delivery: 'delivered' };
  if (letter.state === 'failed') return { label: 'Returned: not collected in 30 days', time: letter.returnedAt, delivery: 'failed' };
  return { label: 'Sent', time: letter.heldAt, delivery: 'sent' };
}

const order = (letter: LocalLetter): [number, number] => (letter.seq === null ? [1, letter.writtenAt] : [0, letter.seq]);

/** The letters of one conversation, oldest first: the held ones by seq, then those still in the outbox as written. */
export function lettersOf(letters: Record<string, LocalLetter>, hidden: Record<string, true>, conversationId: string): LocalLetter[] {
  return Object.values(letters)
    .filter((letter) => letter.conversationId === conversationId && letter.letterClass === 'letter' && !hidden[letter.id])
    .sort((a, b) => {
      const [ga, ka] = order(a);
      const [gb, kb] = order(b);
      return ga - gb || ka - kb;
    });
}

/** What a row or toast shows for a letter: its first line, or Photo or File for an attachment without text. */
export function lineOf(letter: LocalLetter): string {
  const body = letter.body;
  const draft = letter.draft;
  if (body) {
    if (body.kind === 'text') return firstLine(body.text);
    return body.kind === 'image' ? firstLine(body.text) || 'Photo' : 'File';
  }
  if (draft && draft.kind !== 'text') return draft.kind === 'image' ? firstLine(draft.text) || 'Photo' : 'File';
  return '';
}

interface Activity {
  /** When the newest letter still in the outbox was written; 0 when none is. */
  pending: number;
  /** The newest server time the conversation has seen. */
  held: number;
}

/** A conversation sorts by its newest activity; a letter still in the outbox puts it first. */
export function activityOf(conversation: Conversation, letters: LocalLetter[]): Activity {
  const activity: Activity = { pending: 0, held: Date.parse(conversation.updated_at) };
  for (const letter of letters) {
    if (letter.seq === null) activity.pending = Math.max(activity.pending, letter.writtenAt);
    else if (letter.heldAt) activity.held = Math.max(activity.held, Date.parse(letter.heldAt));
  }
  return activity;
}

export const byActivity = (a: Activity, b: Activity): number => b.pending - a.pending || b.held - a.held;
