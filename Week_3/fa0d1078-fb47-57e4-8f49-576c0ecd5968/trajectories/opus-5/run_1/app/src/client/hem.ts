import { stitchesLabel } from '../shared/messages';
import { apply, el } from './dom';
import { COUNT_ROLL_MS, play, STITCH_MS, STITCH_STAGGER_MS } from './motion';

/** The hem thread: one stitch for each correct non-given cell. */
export class HemThread {
  readonly element: HTMLElement;
  readonly counter: HTMLElement;

  private prefix: string;
  private readonly track: HTMLElement;
  private stitches = 0;

  constructor(prefix: string, id: string, counterId: string | null) {
    this.prefix = prefix;
    this.track = el('span', { class: 'hem-track' });
    this.element = el('span', { role: 'img', id, class: 'hem', 'data-stitches': '0' }, [this.track]);
    this.counter = el('span', { class: 'hem-count', ...(counterId ? { id: counterId } : {}) }, ['0']);
    this.setLabel();
  }

  setPrefix(prefix: string): void {
    this.prefix = prefix;
    this.setLabel();
  }

  private setLabel(): void {
    this.element.setAttribute('aria-label', stitchesLabel(this.prefix, this.stitches));
  }

  set(count: number): void {
    if (count === this.stitches) return;
    const growing = count > this.stitches;
    const added: HTMLElement[] = [];
    while (this.stitches < count) {
      const stitch = el('span', { class: 'stitch' });
      this.track.append(stitch);
      added.push(stitch);
      this.stitches += 1;
    }
    const removed: HTMLElement[] = [];
    while (this.stitches > count) {
      const last = this.track.lastElementChild as HTMLElement | null;
      if (!last) break;
      removed.push(last);
      this.stitches -= 1;
    }
    apply(this.element, { 'data-stitches': String(this.stitches) });
    this.setLabel();
    this.counter.textContent = String(this.stitches);

    added.forEach((stitch, index) => {
      play(stitch, [{ transform: 'scaleX(0)', opacity: 0 }, { transform: 'scaleX(1)', opacity: 1 }], {
        duration: STITCH_MS,
        delay: index * STITCH_STAGGER_MS,
        fill: 'backwards',
      });
    });
    for (const stitch of removed) {
      const animation = play(
        stitch,
        [{ transform: 'scaleX(1)', opacity: 1 }, { transform: 'scaleX(0)', opacity: 0 }],
        { duration: STITCH_MS },
      );
      if (animation) animation.addEventListener('finish', () => stitch.remove());
      else stitch.remove();
    }
    play(
      this.counter,
      [
        { transform: `translateY(${growing ? 60 : -60}%)`, opacity: 0 },
        { transform: 'translateY(0)', opacity: 1 },
      ],
      { duration: COUNT_ROLL_MS },
    );
  }

  /** The solved sequence closes the thread into a loop. */
  closeLoop(): void {
    play(this.element, [{ transform: 'scale(1)' }, { transform: 'scale(1.03)' }, { transform: 'scale(1)' }], {
      duration: 940,
    });
  }
}
