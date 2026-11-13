/** Pieces more than one screen needs. */

import type { Dispute } from '../shared/model.js';
import { ask } from './api.js';
import { COPY } from './copy.js';
import { el } from './dom.js';
import type { DeskMessages } from './messages.js';

export function signOutButton(): HTMLButtonElement {
  const button = el('button', { type: 'button', class: 'button' }, ['Sign out']);
  button.addEventListener('click', () => {
    void (async () => {
      await ask({ method: 'DELETE', path: '/api/session' });
      window.location.assign('/sign-in');
    })();
  });
  return button;
}

const SEEN_RULINGS = 'roundkeeper.seen-rulings';

/** The dispute-ruled copy shows once per ruling per signed-in device. */
export class RulingWatcher {
  private readonly seen: Set<number>;

  constructor(private readonly messages: DeskMessages) {
    const held = window.sessionStorage.getItem(SEEN_RULINGS);
    this.seen = new Set(held === null ? [] : (JSON.parse(held) as number[]));
  }

  note(disputes: Dispute[]): void {
    for (const dispute of disputes) {
      if (dispute.status === 'raised' || this.seen.has(dispute.id)) continue;
      this.seen.add(dispute.id);
      this.messages.result(COPY.disputeRuled(dispute.status, dispute.round, dispute.question));
    }
    window.sessionStorage.setItem(SEEN_RULINGS, JSON.stringify([...this.seen]));
  }
}
