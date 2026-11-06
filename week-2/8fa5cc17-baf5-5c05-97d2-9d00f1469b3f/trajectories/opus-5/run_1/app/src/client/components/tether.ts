import { el, prefersReducedMotion, svg } from '../dom';
import { animate, tween } from '../anim';
import { NUMERAL_MS, TETHER_MS } from '../../shared/motion';
import { backlinksPhrase } from '../../shared/copy';

export type QuoteChipTarget = {
  quoteBlockId: string;
  originObjectId: string;
  originTitle: string;
  backlinks: number;
  blockElement: HTMLElement;
};

/** Quoted blocks, margin chips and tethers read as one annotated system. */
export class MarginTether {
  private readonly chips = new Map<string, HTMLAnchorElement>();
  private readonly lines = new Map<string, SVGPathElement>();
  private targets: QuoteChipTarget[] = [];

  constructor(
    private readonly chipHost: HTMLElement,
    private readonly layer: SVGElement,
    private readonly onOpenOrigin: (objectId: string) => void,
  ) {}

  setTargets(targets: QuoteChipTarget[], options: { drawTethers: boolean }): void {
    this.targets = targets;
    const wanted = new Set(targets.map((target) => target.quoteBlockId));
    for (const [id, chip] of [...this.chips]) {
      if (wanted.has(id)) continue;
      chip.remove();
      this.chips.delete(id);
      const line = this.lines.get(id);
      if (line !== undefined) {
        line.remove();
        this.lines.delete(id);
      }
    }
    for (const target of targets) {
      let chip = this.chips.get(target.quoteBlockId);
      if (chip === undefined) {
        chip = this.buildChip(target);
        this.chips.set(target.quoteBlockId, chip);
        this.chipHost.append(chip);
      } else {
        this.updateChip(chip, target);
      }
      if (options.drawTethers && !this.lines.has(target.quoteBlockId)) {
        const line = svg('path', {
          'data-tether': target.quoteBlockId,
          'stroke-width': '1',
          fill: 'none',
          pathLength: '1',
        }) as SVGPathElement;
        line.style.strokeDasharray = '1';
        line.style.strokeDashoffset = '0';
        this.lines.set(target.quoteBlockId, line);
        this.layer.append(line);
      }
    }
    this.position();
  }

  private buildChip(target: QuoteChipTarget): HTMLAnchorElement {
    const chip = el('a', {
      className: 'origin-chip',
      attrs: { href: `/o/${target.originObjectId}` },
    });
    chip.append(
      el('span', { className: 'chip-title', text: target.originTitle }),
      el('span', {
        className: 'chip-count',
        text: String(target.backlinks),
        attrs: { 'data-backlink-count': String(target.backlinks) },
      }),
    );
    chip.setAttribute('aria-label', `Quoted from ${target.originTitle}, ${backlinksPhrase(target.backlinks)}`);
    chip.addEventListener('click', (event) => {
      event.preventDefault();
      this.onOpenOrigin(target.originObjectId);
    });
    return chip;
  }

  private updateChip(chip: HTMLAnchorElement, target: QuoteChipTarget): void {
    const title = chip.querySelector('.chip-title');
    if (title !== null) title.textContent = target.originTitle;
    chip.setAttribute('aria-label', `Quoted from ${target.originTitle}, ${backlinksPhrase(target.backlinks)}`);
    chip.setAttribute('href', `/o/${target.originObjectId}`);
  }

  chipFor(quoteBlockId: string): HTMLAnchorElement | undefined {
    return this.chips.get(quoteBlockId);
  }

  /** Origin chips and tethers stay level with their quoted blocks at every scroll position. */
  position(): void {
    const hostRect = this.chipHost.getBoundingClientRect();
    for (const target of this.targets) {
      const chip = this.chips.get(target.quoteBlockId);
      if (chip === undefined) continue;
      const blockRect = target.blockElement.getBoundingClientRect();
      chip.style.top = `${Math.round(blockRect.top - hostRect.top)}px`;
      const line = this.lines.get(target.quoteBlockId);
      if (line === undefined) continue;
      const chipRect = chip.getBoundingClientRect();
      const x1 = blockRect.left;
      const y1 = blockRect.top + 1;
      const x2 = chipRect.left;
      const y2 = chipRect.top + 1;
      line.setAttribute('d', `M ${x1} ${y1} L ${x2} ${y2}`);
    }
  }

  /** The tether draws itself from the block's left edge to the origin chip. */
  drawTether(quoteBlockId: string): Promise<void> {
    const line = this.lines.get(quoteBlockId);
    if (line === undefined) return Promise.resolve();
    this.position();
    if (prefersReducedMotion()) {
      line.style.strokeDashoffset = '0';
      return Promise.resolve();
    }
    const animation = animate(line, [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], TETHER_MS);
    line.style.strokeDashoffset = '0';
    return animation.finished.then(
      () => undefined,
      () => undefined,
    );
  }

  /** The tether pulls back from where it had reached, never first snapping to full length. */
  retractTether(quoteBlockId: string): Promise<void> {
    const line = this.lines.get(quoteBlockId);
    if (line === undefined) return Promise.resolve();
    const running = line.getAnimations();
    let reached = 0;
    for (const animation of running) {
      const computed = Number(getComputedStyle(line).strokeDashoffset);
      reached = Number.isFinite(computed) ? computed : 0;
      animation.cancel();
    }
    if (prefersReducedMotion()) {
      line.style.strokeDashoffset = '1';
      return Promise.resolve();
    }
    const from = reached;
    const duration = Math.max(1, TETHER_MS * (1 - from));
    const animation = animate(line, [{ strokeDashoffset: from }, { strokeDashoffset: 1 }], duration);
    line.style.strokeDashoffset = '1';
    return animation.finished.then(
      () => undefined,
      () => undefined,
    );
  }

  /** The numeral rolls from the value the page last showed to the server's count. */
  rollNumeral(quoteBlockId: string, to: number): Promise<void> {
    const chip = this.chips.get(quoteBlockId);
    if (chip === undefined) return Promise.resolve();
    const numeral = chip.querySelector<HTMLElement>('.chip-count');
    if (numeral === null) return Promise.resolve();
    const shown = Number(numeral.getAttribute('data-backlink-count'));
    const from = Number.isFinite(shown) ? shown : to - 1;
    return rollCount(numeral, from, to).then(() => {
      chip.setAttribute(
        'aria-label',
        `Quoted from ${chip.querySelector('.chip-title')?.textContent ?? ''}, ${backlinksPhrase(to)}`,
      );
    });
  }

  removeChip(quoteBlockId: string): void {
    const chip = this.chips.get(quoteBlockId);
    if (chip !== undefined) {
      chip.remove();
      this.chips.delete(quoteBlockId);
    }
    const line = this.lines.get(quoteBlockId);
    if (line !== undefined) {
      line.remove();
      this.lines.delete(quoteBlockId);
    }
    this.targets = this.targets.filter((target) => target.quoteBlockId !== quoteBlockId);
  }
}

/** The old digits slide out upward and the new ones slide in from below. */
export function rollCount(numeral: HTMLElement, from: number, to: number): Promise<void> {
  numeral.setAttribute('data-backlink-count', String(to));
  if (prefersReducedMotion()) {
    numeral.textContent = String(to);
    numeral.classList.remove('numeral-flash');
    return Promise.resolve();
  }
  numeral.classList.add('numeral-flash');
  window.setTimeout(() => numeral.classList.remove('numeral-flash'), 1000);
  return new Promise((resolve) => {
    tween(
      NUMERAL_MS,
      (eased) => {
        const value = Math.round(from + (to - from) * eased);
        numeral.textContent = String(value);
        numeral.style.transform = `translateY(${(1 - eased) * -6}px)`;
      },
      {
        onDone: () => {
          numeral.textContent = String(to);
          numeral.style.removeProperty('transform');
          resolve();
        },
      },
    );
  });
}

/** Every backlink numeral on chips and cards alike carries its count. */
export function setNumeral(node: HTMLElement, count: number, flash: boolean): void {
  const shown = Number(node.getAttribute('data-backlink-count'));
  if (Number.isFinite(shown) && shown !== count && flash) {
    void rollCount(node, shown, count);
    return;
  }
  node.setAttribute('data-backlink-count', String(count));
  node.textContent = String(count);
}
