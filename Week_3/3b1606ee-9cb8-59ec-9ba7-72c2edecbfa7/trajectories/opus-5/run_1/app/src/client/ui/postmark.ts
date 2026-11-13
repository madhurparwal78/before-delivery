import { copy } from '../copy.js';
import type { LocalLetter } from '../data/store.js';
import { formatTime } from '../format.js';
import { el } from './dom.js';
import { restrikePostmark, rollDigits, strikePostmark } from './motion.js';

export function labelFor(letter: LocalLetter): string {
  if (letter.direction === 'received') return copy.postmark.received;
  switch (letter.state) {
    case 'sending':
      return copy.postmark.sending;
    case 'sent':
      return copy.postmark.sent;
    case 'delivered':
      return copy.postmark.delivered;
    case 'read':
      return copy.postmark.read;
    case 'failed':
      return letter.failure === 'returned' ? copy.postmark.returned : copy.postmark.failed;
  }
}

/** Only Sending and upload-failed letters show no time. */
export function stampFor(letter: LocalLetter): string | null {
  if (letter.state === 'sending') return null;
  if (letter.state === 'failed' && letter.failure !== 'returned') return null;
  if (letter.direction === 'received') return letter.heldAt;
  switch (letter.state) {
    case 'delivered':
      return letter.deliveredAt ?? letter.heldAt;
    case 'read':
      return letter.readAt ?? letter.heldAt;
    case 'failed':
      return letter.returnedAt ?? letter.heldAt;
    default:
      return letter.heldAt;
  }
}

export interface Postmark {
  element: HTMLElement;
  update: (letter: LocalLetter, restrike: boolean) => void;
}

export function postmark(letter: LocalLetter): Postmark {
  const label = el('span', { class: 'postmark-label', testid: 'postmark-label' });
  const time = el('time', { class: 'postmark-time' });
  const element = el('span', { class: 'postmark', testid: 'postmark' }, [label, time]);

  function paint(current: LocalLetter, restrike: boolean): void {
    label.textContent = labelFor(current);
    const stamp = stampFor(current);
    if (stamp === null) {
      time.removeAttribute('datetime');
      time.textContent = '';
    } else {
      time.setAttribute('datetime', stamp);
      if (restrike) rollDigits(time, formatTime(stamp));
      else time.textContent = formatTime(stamp);
    }
    if (restrike) restrikePostmark(element, label);
  }

  paint(letter, false);
  return {
    element,
    update: (current, restrike) => paint(current, restrike),
  };
}

export function strike(mark: Postmark, letter: LocalLetter): void {
  mark.update(letter, false);
  strikePostmark(mark.element);
}
