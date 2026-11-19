import { register } from '../frame-loop';
import { h } from '../dom';
import type { Stage } from './stage';

interface CalloutSpec { partId: string; label: string; text: string }

interface Entry { spec: CalloutSpec; box: HTMLElement; tether: SVGLineElement; marker: SVGCircleElement; value: number; target: 0 | 1 }

const FADE_MS = 180;
const MARKER_RADIUS = 7;

/** Floating labels tethered to each focus part's projected anchor; they fade on page time and flip sides to stay in the stage. */
export class CalloutLayer {
  readonly element: HTMLElement;
  private readonly overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  private entries = new Map<string, Entry>();
  private last = 0;
  private immediate = false;

  constructor(private readonly stage: Stage) {
    this.overlay.setAttribute('class', 'callout-tethers');
    this.overlay.setAttribute('aria-hidden', 'true');
    this.element = h('div', { class: 'callouts' });
    this.element.append(this.overlay);
    register((now) => this.frame(now));
  }

  /** Replaces the labels shown; labels for the same part stay, new ones fade in, the rest fade out. */
  show(specs: readonly CalloutSpec[], immediate: boolean): void {
    this.immediate = immediate;
    const wanted = new Set(specs.map((s) => s.partId));
    for (const entry of this.entries.values()) if (!wanted.has(entry.spec.partId)) entry.target = 0;
    for (const spec of specs) {
      const existing = this.entries.get(spec.partId);
      if (existing) {
        existing.target = 1;
        existing.spec = spec;
        existing.box.textContent = spec.text;
        existing.box.dataset.callout = spec.label;
        continue;
      }
      const box = h('div', { class: 'callout', 'data-callout': spec.label }, spec.text);
      const tether = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      const marker = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      marker.setAttribute('r', String(MARKER_RADIUS));
      this.overlay.append(tether, marker);
      this.element.append(box);
      this.entries.set(spec.partId, { spec, box, tether, marker, value: immediate ? 1 : 0, target: 1 });
    }
    this.stage.invalidate();
  }

  clear(): void {
    this.show([], true);
  }

  private frame(now: number): boolean {
    const dt = this.last ? now - this.last : 0;
    this.last = now;
    let busy = false;
    const width = this.stage.element.clientWidth;
    const height = this.stage.element.clientHeight;
    let slot = 0;
    for (const [id, entry] of [...this.entries]) {
      const step = this.immediate ? 1 : dt / FADE_MS;
      entry.value = entry.target === 1 ? Math.min(1, entry.value + step) : Math.max(0, entry.value - step);
      if (entry.target === 0 && entry.value <= 0) {
        entry.box.remove();
        entry.tether.remove();
        entry.marker.remove();
        this.entries.delete(id);
        continue;
      }
      if (entry.value !== entry.target) busy = true;
      const anchor = this.stage.project(id);
      const visible = !!anchor && width > 0;
      entry.box.style.display = visible ? '' : 'none';
      for (const part of [entry.tether, entry.marker]) part.style.display = visible ? '' : 'none';
      if (!anchor) continue;
      const box = entry.box;
      const side = (anchor.x > width / 2 ? -1 : 1) * (slot % 2 === 0 ? 1 : -1);
      const boxWidth = box.offsetWidth;
      const boxHeight = box.offsetHeight;
      let x = anchor.x + side * 56 - (side < 0 ? boxWidth : 0);
      if (x < 8 || x + boxWidth > width - 8) x = anchor.x - side * 56 - (side > 0 ? boxWidth : 0);
      x = Math.min(Math.max(8, x), Math.max(8, width - boxWidth - 8));
      const y = Math.min(Math.max(8, anchor.y - boxHeight - 24 - slot * (boxHeight + 10)), Math.max(8, height - boxHeight - 8));
      slot++;
      box.style.transform = `translate(${x}px, ${y}px)`;
      box.style.opacity = String(entry.value);
      const edgeX = x + boxWidth / 2 > anchor.x ? x : x + boxWidth;
      entry.tether.setAttribute('x1', String(edgeX));
      entry.tether.setAttribute('y1', String(y + boxHeight / 2));
      entry.tether.setAttribute('x2', String(anchor.x));
      entry.tether.setAttribute('y2', String(anchor.y));
      entry.marker.setAttribute('cx', String(anchor.x));
      entry.marker.setAttribute('cy', String(anchor.y));
      entry.marker.dataset.hidden = String(anchor.hidden);
      if (anchor.hidden) entry.box.setAttribute('data-part-hidden', 'true');
      else entry.box.removeAttribute('data-part-hidden');
      entry.tether.style.opacity = entry.marker.style.opacity = String(entry.value);
    }
    return busy;
  }
}
