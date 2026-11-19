import type { Dreamscape as DreamscapeData, SignCategory, Tallies } from '../api.js';
import { CATEGORY_LABELS, COPY, signCopy, skyDescription } from '../copy.js';
import { Dialog } from '../dialog.js';
import { h, prefersReducedMotion, setHidden, setText } from '../dom.js';
import { announce, statusRegion } from '../live.js';
import { SKY_CATEGORIES, Sky, emptySkyCounts, type SkyCounts } from './sky.js';

export type LayoutMode = 'phone' | 'tablet' | 'desktop';

const PHASE_UNDERLINE_MS = 120;
const PHASE_FLIGHT_MS = 760;
const PHASE_SETTLE_MS = 1060;
const PHASE_REFUSED_MS = 330;
const ARROW_PAN_PX = 40;

export interface CondensationOutcome {
  readonly ok: boolean;
  readonly category: SignCategory;
  readonly tallies: Tallies | null;
}

export class DreamscapeView {
  readonly region: HTMLElement;
  readonly signsStatus: HTMLElement;
  private readonly skyCanvas: HTMLCanvasElement;
  private readonly skyDescription: HTMLElement;
  private readonly skyWrap: HTMLElement;
  private readonly legend: HTMLElement;
  private readonly legendItems = new Map<SignCategory, HTMLElement>();
  private readonly drillWrap: HTMLElement;
  private readonly drillButton: HTMLButtonElement;
  private readonly noTarget: HTMLElement;
  private readonly stripButton: HTMLButtonElement;
  private readonly stripCanvas: HTMLCanvasElement;
  private readonly legendBox: HTMLElement;
  private readonly inlinePanel: HTMLElement;
  private readonly sheet: Dialog;
  private readonly sheetBody: HTMLElement;
  private readonly sky: Sky;
  private readonly strip: Sky;
  private counts: SkyCounts = emptySkyCounts();
  private targetCategory: SignCategory | null = null;
  private layout: LayoutMode = 'desktop';
  private phaseTimers: number[] = [];
  afterSettle: (() => void) | null = null;

  constructor(onDrill: (target: SignCategory, opener: HTMLElement) => void) {
    const reduced = prefersReducedMotion();
    this.skyCanvas = h('canvas', {
      role: 'img',
      'aria-label': 'Dream-sign sky',
      tabindex: '0',
      'aria-describedby': 'sky-description',
      class: 'sky',
    });
    this.skyDescription = h('span', { id: 'sky-description', class: 'visually-hidden' });
    this.skyWrap = h('div', { class: 'sky-wrap' }, [this.skyCanvas, this.skyDescription]);

    this.legend = h('ul', { role: 'list', 'aria-label': 'Dream-sign legend', class: 'legend' });
    for (const category of SKY_CATEGORIES) {
      const item = h('li', { class: 'legend-item' });
      this.legendItems.set(category, item);
      this.legend.append(item);
    }

    this.drillButton = h('button', {
      type: 'button',
      class: 'primary drill',
      text: 'Reality check drill',
      disabled: true,
    });
    this.noTarget = h('p', { class: 'muted no-target', text: COPY.noDrillTarget });
    this.drillWrap = h('div', { class: 'drill-wrap' }, [this.drillButton, this.noTarget]);
    this.drillButton.addEventListener('click', () => {
      if (this.targetCategory !== null) onDrill(this.targetCategory, this.drillButton);
    });

    this.signsStatus = statusRegion('Dream signs', 'signs-status');
    this.legendBox = h('div', { class: 'legend-box' }, [this.legend, this.signsStatus]);

    this.stripCanvas = h('canvas', { class: 'strip-sky', 'aria-hidden': 'true' });
    this.stripButton = h('button', {
      type: 'button',
      class: 'strip',
      'aria-label': 'Open dreamscape',
    }, [this.stripCanvas]);
    this.stripButton.addEventListener('click', () => {
      this.sheet.open(this.stripButton, this.skyCanvas);
      this.resize();
    });

    this.sheetBody = h('div', { class: 'sheet-body' });
    this.sheet = new Dialog({ label: 'Dreamscape', className: 'sheet' });
    const closeSheet = h('button', {
      type: 'button',
      class: 'ghost',
      text: 'Close dreamscape',
      'aria-label': 'Close dreamscape',
    });
    closeSheet.addEventListener('click', () => {
      this.sheet.close();
    });
    this.sheet.element.append(this.sheetBody, closeSheet);

    this.inlinePanel = h('div', { class: 'dreamscape-panel' });
    this.region = h('section', {
      role: 'region',
      'aria-label': 'Dreamscape',
      'data-phase': 'idle',
      class: 'dreamscape',
    }, [this.inlinePanel, this.sheet.element]);

    this.sky = new Sky(this.skyCanvas, reduced);
    this.strip = new Sky(this.stripCanvas, reduced, true);
    this.applyLayout('desktop');
    this.bindPanning();
    this.renderLegend();

    window.addEventListener('resize', () => {
      this.resize();
    });
    const observer = new ResizeObserver(() => {
      this.resize();
    });
    observer.observe(this.skyWrap);
    observer.observe(this.stripButton);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.sky.stopFog();
      else this.sky.startFog();
    });
    window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (event) => {
      this.sky.setReducedMotion(event.matches);
      if (event.matches) this.sky.stopFog();
      else this.sky.startFog();
    });
    this.sky.startFog();
  }

  get target(): SignCategory | null {
    return this.targetCategory;
  }

  applyLayout(mode: LayoutMode): void {
    this.layout = mode;
    if (mode === 'phone') {
      this.sheetBody.append(this.skyWrap, this.legend, this.drillWrap);
      this.region.replaceChildren(this.stripButton, this.signsStatus, this.sheet.element);
    } else {
      this.sheet.close();
      this.legendBox.replaceChildren(this.legend, this.signsStatus);
      this.inlinePanel.replaceChildren(this.skyWrap, this.drillWrap, this.legendBox);
      this.region.replaceChildren(this.inlinePanel, this.sheet.element);
    }
    this.resize();
  }

  resize(): void {
    this.sky.resize();
    this.strip.resize();
  }

  private bindPanning(): void {
    let dragging = false;
    let last = { x: 0, y: 0 };
    this.skyCanvas.addEventListener('pointerdown', (event) => {
      dragging = true;
      last = { x: event.clientX, y: event.clientY };
      this.skyCanvas.setPointerCapture(event.pointerId);
    });
    this.skyCanvas.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      event.preventDefault();
      this.sky.panBy(event.clientX - last.x, event.clientY - last.y);
      last = { x: event.clientX, y: event.clientY };
    });
    const stop = (event: PointerEvent): void => {
      dragging = false;
      if (this.skyCanvas.hasPointerCapture(event.pointerId)) {
        this.skyCanvas.releasePointerCapture(event.pointerId);
      }
    };
    this.skyCanvas.addEventListener('pointerup', stop);
    this.skyCanvas.addEventListener('pointercancel', stop);
    this.skyCanvas.addEventListener('touchmove', (event) => {
      event.preventDefault();
    });
    this.skyCanvas.addEventListener('keydown', (event) => {
      const moves: Record<string, [number, number]> = {
        ArrowLeft: [-ARROW_PAN_PX, 0],
        ArrowRight: [ARROW_PAN_PX, 0],
        ArrowUp: [0, -ARROW_PAN_PX],
        ArrowDown: [0, ARROW_PAN_PX],
      };
      const move = moves[event.key];
      if (move !== undefined) {
        event.preventDefault();
        this.sky.panBy(move[0], move[1]);
        return;
      }
      if (event.key === 'Home') {
        event.preventDefault();
        this.sky.recentre();
      }
    });
  }

  private renderLegend(): void {
    for (const category of SKY_CATEGORIES) {
      const item = this.legendItems.get(category);
      if (item === undefined) continue;
      const suffix = this.targetCategory === category ? ' (drill target)' : '';
      setText(item, `${CATEGORY_LABELS[category]}: ${this.counts.stars[category]}${suffix}`);
    }
    setText(this.skyDescription, skyDescription(this.counts.stars));
    this.drillButton.disabled = this.targetCategory === null;
    setHidden(this.noTarget, this.targetCategory !== null);
  }

  setData(data: DreamscapeData, fadeIn = false): void {
    const stars: Record<SignCategory, number> = {
      inner_awareness: 0,
      action: 0,
      form: 0,
      context: 0,
    };
    const halos: Record<SignCategory, number> = {
      inner_awareness: 12,
      action: 12,
      form: 12,
      context: 12,
    };
    for (const constellation of data.constellations) {
      stars[constellation.category] = constellation.stars;
      halos[constellation.category] = constellation.halo_px;
    }
    this.counts = { stars, halos };
    this.targetCategory = data.target_category;
    this.sky.setCounts(this.counts, fadeIn);
    this.strip.setCounts(this.counts, false);
    this.renderLegend();
  }

  private setPhase(phase: string): void {
    this.region.setAttribute('data-phase', phase);
  }

  private clearTimers(): void {
    for (const timer of this.phaseTimers) window.clearTimeout(timer);
    this.phaseTimers = [];
  }

  private flight(origin: DOMRect | null, phrase: string): HTMLElement | null {
    if (origin === null) return null;
    const node = h('span', { class: 'phrase-flight', text: phrase });
    node.style.left = `${origin.left}px`;
    node.style.top = `${origin.top}px`;
    document.body.append(node);
    return node;
  }

  startCondensation(
    category: SignCategory,
    phrase: string,
    origin: DOMRect | null,
    pending: Promise<CondensationOutcome>,
  ): void {
    const reduced = prefersReducedMotion();
    this.clearTimers();
    this.setPhase('underline');
    const started = Date.now();
    const copy = reduced ? null : this.flight(origin, phrase);
    if (copy !== null) {
      this.phaseTimers.push(
        window.setTimeout(() => {
          this.setPhase('flight');
          copy.classList.add('flying');
        }, PHASE_UNDERLINE_MS),
        window.setTimeout(() => {
          this.setPhase('settle');
          copy.classList.add('settling');
        }, PHASE_FLIGHT_MS),
      );
    }
    void pending.then((outcome) => {
      const finish = (): void => {
        copy?.remove();
        if (!outcome.ok) {
          this.setPhase('refused');
          this.phaseTimers.push(
            window.setTimeout(() => {
              this.setPhase('idle');
            }, PHASE_REFUSED_MS),
          );
          return;
        }
        if (outcome.tallies !== null) {
          const counts = { ...this.counts.stars, ...outcome.tallies };
          this.counts = { stars: counts, halos: this.counts.halos };
          this.sky.setCounts(this.counts, true);
          this.strip.setCounts(this.counts, false);
          this.renderLegend();
          announce(this.signsStatus, signCopy(category, outcome.tallies[category]));
        }
        this.setPhase('idle');
        this.afterSettle?.();
      };
      const wait = reduced ? 0 : Math.max(0, PHASE_SETTLE_MS - (Date.now() - started));
      if (wait === 0) finish();
      else this.phaseTimers.push(window.setTimeout(finish, wait));
    });
  }

  announceSigns(text: string): void {
    announce(this.signsStatus, text);
  }

}
