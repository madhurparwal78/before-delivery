import type { Tx } from '../db.ts';
import type { LiveAnnouncement, RestackResult } from '../../shared/types.ts';

/** Collects what one operation says to open pages and sends it as a single live event. */
export class Events {
  readonly numbers = new Set<number>();
  readonly announce: LiveAnnouncement[] = [];
  readonly restack: RestackResult[] = [];
  queue = false;

  say(text: string, on: LiveAnnouncement['on'] = 'change'): void {
    this.announce.push({ text, on });
  }

  touch(numbers: Iterable<number>): void {
    for (const number of numbers) this.numbers.add(number);
  }

  emit(tx: Tx, repoId: number): void {
    if (!this.numbers.size && !this.queue) return;
    tx.emit(repoId, {
      numbers: [...this.numbers],
      announce: this.announce,
      restack: this.restack.length ? this.restack : undefined,
      queue: this.queue || undefined,
    });
  }
}
