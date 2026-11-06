import { UI } from '../../shared/copy.js';
import type { Batch } from '../../shared/types.js';
import { dropScent } from '../../shared/catalog.js';
import { locale } from '../i18n.js';
import { bind, el, say } from '../ui.js';
import { buildDiagram } from './diagram.js';
import { LoafScene, type BarMark, type SceneReading } from './scene.js';

export const SCROLL_TRAVEL = 2_400;
const YAW_RANGE = 24;
const YAW_RETURN_MS = 320;

export function scrollOffset(): number {
  return Math.min(SCROLL_TRAVEL, Math.max(0, Math.floor(window.scrollY)));
}

export function progressOf(offset: number): string {
  return (Math.floor((offset * 1_000 + 1_200) / SCROLL_TRAVEL) / 1_000).toFixed(3);
}

export function wireOf(offset: number, barsTotal: number): string {
  return (Math.floor((offset * barsTotal) / 24) / 100).toFixed(2);
}

export function cutStepOf(offset: number, barsTotal: number): number {
  return Math.floor((offset * barsTotal) / SCROLL_TRAVEL);
}

export function deepLinkOffset(bar: number, barsTotal: number): number | null {
  if (!Number.isInteger(bar) || bar < 1 || bar > barsTotal) return null;
  return Math.ceil((SCROLL_TRAVEL * bar) / barsTotal);
}

function marksOf(batch: Batch): BarMark[] {
  return batch.bars.map((bar) => (bar.status === 'available' ? 'A' : bar.status === 'held' ? 'H' : 'S'));
}

export class LoafFigure {
  readonly element: HTMLElement;
  private readonly caption: HTMLElement;
  private readonly scene: LoafScene;
  private readonly diagramHost: HTMLElement;
  private batch: Batch | null = null;
  private yaw = 0;
  private yawFrame: number | null = null;
  private reduced = false;
  private reading: SceneReading = { band: [0, 0], spans: [], animating: false };

  constructor() {
    this.scene = new LoafScene((reading) => {
      this.reading = reading;
      this.writeSceneAttributes();
    });
    this.caption = el('figcaption', { class: 'loaf-caption' });
    this.diagramHost = el('div', { class: 'loaf-diagram' });
    this.element = el('figure', { class: 'loaf-figure' }, [
      el('div', { class: 'loaf-stage' }, [this.scene.canvas, this.diagramHost]),
      this.caption,
    ]);
    bind(() => {
      this.element.setAttribute('aria-label', say(UI.loafFigure));
      this.scene.canvas.setAttribute('aria-label', say(UI.loafCanvas));
      this.caption.textContent = this.captionText();
      this.renderDiagram();
    });
    this.watchReducedMotion();
    this.watchPointer();
    this.watchScroll();
    this.watchResize();
    this.scene.start();
    this.apply();
  }

  private captionText(): string {
    const total = this.batch?.bars_cut ?? 0;
    const step = cutStepOf(scrollOffset(), total);
    return locale() === 'fr-CA' ? `Coupe ${step} sur ${total}` : `Cut ${step} of ${total}`;
  }

  setBatch(batch: Batch | null): void {
    this.batch = batch;
    this.apply();
  }

  private watchReducedMotion(): void {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.reduced = query.matches;
    query.addEventListener('change', (event) => {
      this.reduced = event.matches;
      if (this.reduced) this.yaw = 0;
      this.apply();
    });
  }

  private watchPointer(): void {
    const stage = this.element;
    stage.addEventListener('pointermove', (event) => {
      if (event.pointerType === 'touch' || this.reduced) return;
      const box = stage.getBoundingClientRect();
      const offset = (event.clientX - box.left) / Math.max(1, box.width);
      this.yaw = Math.round((offset - 0.5) * YAW_RANGE);
      this.apply();
    });
    stage.addEventListener('pointerleave', (event) => {
      if (event.pointerType === 'touch') return;
      this.returnYaw();
    });
    stage.addEventListener('pointerdown', (event) => {
      if (event.pointerType !== 'touch') return;
      this.yaw = 0;
      this.apply();
    });
  }

  private returnYaw(): void {
    if (this.yawFrame !== null) return;
    const from = this.yaw;
    const start = performance.now();
    const step = (time: number): void => {
      const share = Math.min(1, (time - start) / YAW_RETURN_MS);
      const eased = 1 - (1 - share) ** 3;
      this.yaw = Math.round(from * (1 - eased));
      this.apply();
      if (share < 1) {
        this.yawFrame = requestAnimationFrame(step);
      } else {
        this.yawFrame = null;
        this.yaw = 0;
        this.apply();
      }
    };
    this.yawFrame = requestAnimationFrame(step);
  }

  private watchScroll(): void {
    window.addEventListener('scroll', () => this.apply(), { passive: true });
  }

  private watchResize(): void {
    window.addEventListener('resize', () => {
      this.scene.resize();
      this.apply();
    });
  }

  /** Every data attribute is written from the integer scroll offset, in the same frame. */
  apply(): void {
    const batch = this.batch;
    const total = batch?.bars_cut ?? 0;
    const offset = scrollOffset();
    const marks = batch ? marksOf(batch) : [];
    this.element.dataset['state'] = this.scene.state;
    this.element.dataset['batch'] = batch?.code ?? '';
    this.element.dataset['tint'] = batch ? dropScent(batch.scent)?.tint ?? '' : '';
    this.element.dataset['swirlSeed'] = batch?.code ?? '';
    this.element.dataset['barsTotal'] = String(total);
    this.element.dataset['progress'] = progressOf(offset);
    this.element.dataset['wire'] = wireOf(offset, total);
    this.element.dataset['cutStep'] = String(cutStepOf(offset, total));
    this.element.dataset['bars'] = marks.join('');
    this.element.dataset['yaw'] = String(this.reduced ? 0 : this.yaw);
    this.element.dataset['motion'] = this.reduced ? 'reduced' : 'full';
    this.caption.textContent = this.captionText();
    this.scene.setInput({
      batch: batch?.code ?? '',
      tint: batch ? dropScent(batch.scent)?.tint ?? 'lilac' : 'lilac',
      bars: marks,
      cutStep: cutStepOf(offset, total),
      wire: total === 0 ? 0 : (offset * total) / SCROLL_TRAVEL,
      yaw: this.reduced ? 0 : this.yaw,
      reduced: this.reduced,
      locale: locale(),
    });
    this.writeSceneAttributes();
    this.renderDiagram();
  }

  private writeSceneAttributes(): void {
    const state = this.scene.state;
    this.element.dataset['state'] = state;
    this.element.dataset['loafBand'] = `${this.reading.band[0]}-${this.reading.band[1]}`;
    this.element.dataset['barSpans'] = this.reading.spans
      .map(([from, to]) => `${from}-${to}`)
      .join(' ');
    this.element.dataset['animating'] = this.scene.isAnimating() ? 'true' : 'false';
    const fallback = state !== 'ready';
    this.scene.canvas.hidden = fallback;
    this.scene.canvas.setAttribute('aria-hidden', fallback ? 'true' : 'false');
    this.diagramHost.hidden = !fallback;
    this.renderDiagram();
  }

  private renderDiagram(): void {
    if (this.scene.state === 'ready') {
      while (this.diagramHost.firstChild) this.diagramHost.firstChild.remove();
      return;
    }
    const batch = this.batch;
    const total = batch?.bars_cut ?? 0;
    const diagram = buildDiagram({
      marks: batch ? marksOf(batch) : [],
      cutStep: cutStepOf(scrollOffset(), total),
      label: say(UI.loafDiagram),
      locale: locale(),
    });
    while (this.diagramHost.firstChild) this.diagramHost.firstChild.remove();
    this.diagramHost.append(diagram);
  }
}
