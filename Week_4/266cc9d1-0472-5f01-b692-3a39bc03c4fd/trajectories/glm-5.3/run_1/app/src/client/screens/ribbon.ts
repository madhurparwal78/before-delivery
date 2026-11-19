import type { Tower, Finding } from '../api.js';
import { withCommas } from '../format.js';

/**
 * The span ribbon: linear monotonic chainage mapping, tower ticks, hairline
 * rules, hatched uncovered ranges, and the playhead.
 */

export type RibbonCallbacks = {
  onScrubInput(chainage: number): void;
  onScrubCommit(chainage: number): void;
  onStep(dir: 'prev' | 'next'): void;
};

export class SpanRibbon {
  el: HTMLElement;
  private slider: HTMLInputElement;
  private playhead: HTMLElement;
  private trackEl: HTMLElement;
  private towers: Tower[] = [];
  private coverage: Array<{ from_m: number; to_m: number }> = [];
  private uncovered: Array<{ from: number; to: number }> = [];
  private length = 1;
  private valueTextFn: (c: number) => string;
  private dragging = false;
  private glide = 0;

  constructor(parent: HTMLElement, valueText: (c: number) => string, cb: RibbonCallbacks) {
    this.valueTextFn = valueText;
    this.el = document.createElement('section');
    this.el.setAttribute('role', 'region');
    this.el.setAttribute('aria-label', 'Span ribbon');
    this.el.className = 'span-ribbon';

    const prev = document.createElement('button');
    prev.type = 'button';
    prev.textContent = 'Previous span';
    prev.setAttribute('aria-label', 'Previous span');
    prev.className = 'ribbon-btn';
    prev.addEventListener('click', () => cb.onStep('prev'));

    this.slider = document.createElement('input');
    this.slider.type = 'range';
    this.slider.min = '0';
    this.slider.step = '0.1';
    this.slider.setAttribute('aria-label', 'Corridor chainage');
    this.slider.addEventListener('input', () => {
      const c = Number(this.slider.value);
      cb.onScrubInput(c);
    });
    this.slider.addEventListener('change', () => {
      const c = Number(this.slider.value);
      cb.onScrubCommit(c);
    });
    this.slider.addEventListener('keydown', (e) => {
      const cur = Number(this.slider.value);
      const big = e.shiftKey ? 100 : 10;
      switch (e.key) {
        case 'ArrowLeft': case 'ArrowDown':
          e.preventDefault(); cb.onScrubCommit(Math.max(0, cur - big)); break;
        case 'ArrowRight': case 'ArrowUp':
          e.preventDefault(); cb.onScrubCommit(Math.min(this.length, cur + big)); break;
        case 'PageUp': {
          e.preventDefault();
          const before = this.towers.map((t) => t.chainage_m).filter((c) => c < cur);
          cb.onScrubCommit(before.length ? Math.max(...before) : 0);
          break;
        }
        case 'PageDown': {
          e.preventDefault();
          const after = this.towers.map((t) => t.chainage_m).filter((c) => c > cur);
          cb.onScrubCommit(after.length ? Math.min(...after) : this.length);
          break;
        }
        case 'Home': e.preventDefault(); cb.onScrubCommit(0); break;
        case 'End': e.preventDefault(); cb.onScrubCommit(this.length); break;
      }
    });

    const next = document.createElement('button');
    next.type = 'button';
    next.textContent = 'Next span';
    next.setAttribute('aria-label', 'Next span');
    next.className = 'ribbon-btn';
    next.addEventListener('click', () => cb.onStep('next'));

    this.trackEl = document.createElement('div');
    this.trackEl.className = 'ribbon-track';
    this.playhead = document.createElement('div');
    this.playhead.className = 'playhead';
    this.trackEl.append(this.playhead);
    this.trackEl.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.trackEl.setPointerCapture(e.pointerId);
      const c = this.chainageFromClient(e.clientX);
      cb.onScrubInput(c);
    });
    this.trackEl.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      cb.onScrubInput(this.chainageFromClient(e.clientX));
    });
    const release = (e: PointerEvent) => {
      if (!this.dragging) return;
      this.dragging = false;
      cb.onScrubCommit(this.chainageFromClient(e.clientX));
    };
    this.trackEl.addEventListener('pointerup', release);
    this.trackEl.addEventListener('pointercancel', release);

    const controls = document.createElement('div');
    controls.className = 'ribbon-controls';
    controls.append(prev, this.slider, next);
    this.el.append(this.trackEl, controls);
    parent.append(this.el);
  }

  private chainageFromClient(clientX: number): number {
    const rect = this.trackEl.getBoundingClientRect();
    const t = (clientX - rect.left) / Math.max(1, rect.width);
    return Math.max(0, Math.min(this.length, t * this.length));
  }

  setGeometry(towers: Tower[], coverage: Array<{ from_m: number; to_m: number }>, uncovered: Array<{ from: number; to: number }>, length: number): void {
    this.towers = towers;
    this.coverage = coverage;
    this.uncovered = uncovered;
    this.length = length;
    this.slider.max = String(length);
    this.drawTicks();
  }

  setFindingsNear(_chainage: number): void {
    // Ring marks live in the globe; the ribbon stays free of finding marks.
    void _chainage;
  }

  private chainageToPct(c: number): number {
    return (c / Math.max(1, this.length)) * 100;
  }

  private drawTicks(): void {
    this.trackEl.querySelectorAll('.tick, .rule, .hatch, .hatch-label').forEach((n) => n.remove());
    for (const t of this.towers) {
      const tick = document.createElement('div');
      tick.className = 'tick';
      tick.style.left = `${this.chainageToPct(t.chainage_m)}%`;
      const label = document.createElement('span');
      label.textContent = `T${t.number}`;
      tick.append(label);
      this.trackEl.append(tick);
    }
    for (let c = 0; c <= this.length; c += 100) {
      const rule = document.createElement('div');
      rule.className = 'rule';
      rule.style.left = `${this.chainageToPct(c)}%`;
      if (c % 500 === 0) {
        const label = document.createElement('span');
        label.textContent = withCommas(c);
        label.className = 'rule-label';
        rule.append(label);
      }
      this.trackEl.append(rule);
    }
    for (const r of this.uncovered) {
      const hatch = document.createElement('div');
      hatch.className = 'hatch';
      hatch.style.left = `${this.chainageToPct(r.from)}%`;
      hatch.style.width = `${this.chainageToPct(r.to) - this.chainageToPct(r.from)}%`;
      const label = document.createElement('span');
      label.className = 'hatch-label';
      label.textContent = 'No flight coverage';
      hatch.append(label);
      this.trackEl.append(hatch);
    }
    void this.coverage;
  }

  /** Move the playhead. Dragging follows the pointer with no glide. */
  setPlayhead(chainage: number, immediate: boolean): void {
    const pct = this.chainageToPct(chainage);
    cancelAnimationFrame(this.glide);
    if (immediate || document.documentElement.classList.contains('reduced-motion')) {
      this.playhead.style.left = `${pct}%`;
    } else {
      const start = parseFloat(this.playhead.style.left) || 0;
      const t0 = performance.now();
      const dur = 200;
      const step = (now: number) => {
        const t = Math.min(1, (now - t0) / dur);
        const k = 1 - (1 - t) * (1 - t);
        this.playhead.style.left = `${start + (pct - start) * k}%`;
        if (t < 1) this.glide = requestAnimationFrame(step);
      };
      this.glide = requestAnimationFrame(step);
    }
    this.slider.value = String(chainage);
    this.slider.setAttribute('aria-valuenow', String(Math.round(chainage)));
    this.slider.setAttribute('aria-valuetext', this.valueTextFn(chainage));
  }

  setSliderValueText(text: string): void {
    this.slider.setAttribute('aria-valuetext', text);
  }

  get sliderEl(): HTMLInputElement {
    return this.slider;
  }
}
