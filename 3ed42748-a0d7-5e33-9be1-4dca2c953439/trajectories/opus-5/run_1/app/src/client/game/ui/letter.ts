import { el, twoDecimals } from '../../shared/dom.js';
import { Tween, ease, motion, onFrame } from '../../shared/motion.js';
import { PaperDialog } from './shell.js';

const UNFOLD_MS = 400;
const FOLD_MS = 250;

export interface LetterOffer {
  kind: 'offer';
  resident: string;
  lines: string[];
  onTake: () => void;
}

export interface LetterThanks {
  kind: 'thanks';
  resident: string;
  lines: string[];
}

export type LetterContent = LetterOffer | LetterThanks;

/** A folded letter that unfolds from the resident's door on screen. */
export class Letter {
  readonly dialog: PaperDialog;
  readonly takeButton: HTMLButtonElement;
  private readonly notNow: HTMLButtonElement;
  private readonly foldButton: HTMLButtonElement;
  private readonly lines: HTMLElement;
  private readonly tween = new Tween();
  private fold: 'unfolding' | 'open' | 'folding' = 'open';
  private progress = 0;
  private from = 0;
  private closing = false;
  private opener: HTMLElement | null = null;
  private doorPoint: { x: number; y: number } = { x: 0, y: 0 };

  constructor(
    private readonly onClose: () => void,
    private readonly onTakePress: () => void,
  ) {
    this.lines = el('div', { class: 'letter-lines' });
    this.takeButton = el('button', { type: 'button', class: 'primary' }, ['Take the parcel']);
    this.notNow = el('button', { type: 'button' }, ['Not now']);
    this.foldButton = el('button', { type: 'button' }, ['Fold letter']);
    this.dialog = new PaperDialog({
      label: 'Letter',
      className: 'letter',
      onEscape: () => this.startFold(),
    });
    this.takeButton.addEventListener('click', () => {
      if (this.takeButton.getAttribute('aria-disabled') === 'true') return;
      this.onTakePress();
    });
    this.notNow.addEventListener('click', () => this.startFold());
    this.foldButton.addEventListener('click', () => this.startFold());
    onFrame((now) => this.draw(now));
  }

  get isOpen(): boolean {
    return this.dialog.open;
  }

  get root(): HTMLElement {
    return this.dialog.root;
  }

  /** Opens the letter, growing it from the door's place on screen. */
  show(content: LetterContent, door: { x: number; y: number }, opener: HTMLElement | null): void {
    this.opener = opener;
    this.doorPoint = door;
    this.dialog.relabel(`Letter from ${content.resident}`);
    this.lines.replaceChildren(...content.lines.map((line) => el('p', {}, [line])));
    const actions =
      content.kind === 'offer'
        ? el('div', { class: 'letter-actions' }, [this.takeButton, this.notNow])
        : el('div', { class: 'letter-actions' }, [this.foldButton]);
    this.takeButton.removeAttribute('aria-disabled');
    this.dialog.replace([this.lines, actions]);
    this.closing = false;
    this.root.setAttribute('data-unfold-from', `${door.x},${door.y}`);
    if (motion.reduced) {
      this.fold = 'open';
      this.progress = 1;
      this.tween.stop();
    } else {
      this.fold = 'unfolding';
      this.from = this.progress;
      this.tween.start(UNFOLD_MS);
    }
    this.write();
    this.dialog.show(opener, content.kind === 'offer' ? this.takeButton : this.foldButton);
  }

  setPending(pending: boolean): void {
    if (pending) this.takeButton.setAttribute('aria-disabled', 'true');
    else this.takeButton.removeAttribute('aria-disabled');
  }

  /** Closing from part way through only ever lowers the fold progress. */
  startFold(): void {
    if (!this.dialog.open || this.closing) return;
    this.closing = true;
    if (motion.reduced) {
      this.finish();
      return;
    }
    this.fold = 'folding';
    this.from = this.progress;
    this.tween.start(FOLD_MS);
    this.write();
  }

  private finish(): void {
    this.progress = 0;
    this.fold = 'open';
    this.closing = false;
    this.write();
    this.dialog.close();
    this.onClose();
  }

  private draw(now: number): void {
    if (!this.dialog.open) return;
    if (this.fold === 'unfolding') {
      const amount = ease(this.tween.progress(now));
      this.progress = this.from + (1 - this.from) * amount;
      if (!this.tween.active) {
        this.progress = 1;
        this.fold = 'open';
      }
      this.write();
    } else if (this.fold === 'folding') {
      const amount = ease(this.tween.progress(now));
      this.progress = this.from * (1 - amount);
      if (!this.tween.active) {
        this.finish();
        return;
      }
      this.write();
    }
  }

  private write(): void {
    this.root.setAttribute('data-fold', this.fold);
    this.root.setAttribute('data-fold-progress', twoDecimals(this.progress));
    this.root.setAttribute('data-unfold-from', `${this.doorPoint.x},${this.doorPoint.y}`);
    const box = this.root.getBoundingClientRect();
    const restX = box.width === 0 ? 0 : box.left + box.width / 2;
    const restY = box.height === 0 ? 0 : box.top + box.height / 2;
    const shiftX = (this.doorPoint.x - restX) * (1 - this.progress);
    const shiftY = (this.doorPoint.y - restY) * (1 - this.progress);
    const scaleAmount = 0.12 + 0.88 * this.progress;
    this.root.style.transform = `translate(${shiftX}px, ${shiftY}px) scale(${scaleAmount})`;
    this.root.style.opacity = String(Math.min(1, 0.25 + this.progress));
  }

  /** Reduced motion turned on part way through lands the letter at its resting place. */
  settleForPreference(): void {
    if (!motion.reduced || !this.dialog.open) return;
    if (this.fold === 'unfolding') {
      this.progress = 1;
      this.fold = 'open';
      this.tween.stop();
      this.write();
    } else if (this.fold === 'folding') {
      this.finish();
    }
  }

  get opened(): HTMLElement | null {
    return this.opener;
  }
}
