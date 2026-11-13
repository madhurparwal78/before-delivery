/** The masthead and the round strip, on every screen. */

import type { Round } from '../shared/model.js';
import { roundStatusLabel } from '../shared/model.js';
import { el, setText } from './dom.js';

export class Shell {
  readonly banner: HTMLElement;
  private readonly strip: HTMLElement;
  private readonly night: HTMLElement;
  private readonly chips = new Map<number, HTMLElement>();

  constructor(signOut: HTMLElement | null) {
    this.strip = el('ul', { class: 'round-strip', 'aria-label': 'Rounds tonight' });
    this.night = el('span', { class: 'masthead-night' });
    const title = el('div', { class: 'masthead' }, [
      el('span', { class: 'masthead-product' }, ['Roundkeeper']),
      el('span', { class: 'masthead-league' }, ['Snug Thursday League']),
      this.night,
    ]);
    const bar = el('div', { class: 'masthead-bar' }, signOut === null ? [title] : [title, signOut]);
    this.banner = el('header', { role: 'banner', class: 'banner' }, [bar, this.strip]);
  }

  update(rounds: Round[], night: number): void {
    setText(this.night, `Night ${night}`);
    for (const round of rounds) {
      let chip = this.chips.get(round.number);
      if (chip === undefined) {
        chip = el('li', { class: 'chip' });
        this.chips.set(round.number, chip);
        this.strip.append(chip);
      }
      setText(chip, `Round ${round.number} · ${roundStatusLabel(round.status)}`);
      chip.className = `chip chip-${round.status}`;
    }
  }
}
