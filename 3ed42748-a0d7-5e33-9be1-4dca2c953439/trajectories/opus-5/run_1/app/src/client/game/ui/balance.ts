import { el } from '../../shared/dom.js';
import { Tween, motion, onFrame } from '../../shared/motion.js';

const PRESS_MS = 250;
const GLOW_MS = 500;

/** The stamp balance: each confirmed change plays its own stamp-press, in turn. */
export class BalanceReadout {
  readonly region: HTMLElement;
  private readonly numeral: HTMLElement;
  private shown = 0;
  private presses = 0;
  private readonly queue: number[] = [];
  private pressing: number | null = null;
  private readonly tween = new Tween();
  private switched = false;
  private glowUntil = 0;

  constructor() {
    this.numeral = el('strong', { class: 'balance-numeral' }, ['0']);
    this.region = el(
      'div',
      {
        role: 'status',
        'aria-label': 'Stamp balance',
        class: 'balance',
        'data-balance-shown': '0',
        'data-stamp-presses': '0',
      },
      [this.numeral, el('span', { class: 'balance-unit' }, [' stamps'])],
    );
    onFrame((now) => this.draw(now));
  }

  /** The first reading of a save shows at once, with no press. */
  settle(balance: number): void {
    this.shown = balance;
    this.queue.length = 0;
    this.pressing = null;
    this.tween.stop();
    this.write();
  }

  change(balance: number): void {
    if (balance === this.shown && this.queue.length === 0 && this.pressing === null) return;
    this.queue.push(balance);
  }

  private draw(now: number): void {
    if (this.pressing === null) {
      const next = this.queue.shift();
      if (next === undefined) {
        this.region.classList.toggle('glowing', now < this.glowUntil);
        return;
      }
      this.pressing = next;
      this.switched = false;
      this.tween.start(motion.reduced ? 0 : PRESS_MS, now);
      if (motion.reduced) {
        this.shown = next;
        this.presses += 1;
        this.pressing = null;
        this.write();
        return;
      }
    }
    const progress = this.tween.progress(now);
    if (!this.switched && progress >= 0.5) {
      this.switched = true;
      this.shown = this.pressing;
      this.write();
    }
    const squash = 1 - Math.sin(progress * Math.PI) * 0.18;
    this.numeral.style.transform = `scale(${squash})`;
    if (!this.tween.active) {
      this.shown = this.pressing;
      this.pressing = null;
      this.presses += 1;
      this.glowUntil = now + GLOW_MS;
      this.numeral.style.transform = 'scale(1)';
      this.write();
    }
    this.region.classList.toggle('glowing', now < this.glowUntil);
  }

  private write(): void {
    this.numeral.textContent = String(this.shown);
    this.region.setAttribute('data-balance-shown', String(this.shown));
    this.region.setAttribute('data-stamp-presses', String(this.presses));
  }
}
