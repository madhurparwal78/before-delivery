import { MOTION } from '../shared/scrollmap.js';
import type { Part, Step } from '../shared/types.js';
import { addFrameTask } from './motion.js';
import type { Stage } from './stage.js';

interface Tethered {
  element: HTMLDivElement;
  tether: HTMLDivElement;
  marker: HTMLDivElement;
  partId: string;
}

/**
 * Callouts tethered to each focus part's projected anchor, flipping sides to
 * stay inside the viewport, with a hollow end marker when the part is hidden.
 */
export class Callouts {
  private shown: Tethered[] = [];
  private fading = false;

  constructor(
    private readonly layer: HTMLElement,
    private readonly stage: Stage,
    private readonly parts: readonly Part[],
  ) {
    addFrameTask(() => {
      this.place();
      return true;
    });
  }

  show(step: Step, immediate: boolean): void {
    this.layer.replaceChildren();
    const byId = new Map(this.parts.map((part) => [part.id, part]));
    const texts = new Map(step.callouts.map((callout) => [callout.part_id, callout.text]));
    this.shown = step.focus_parts.slice(0, MOTION_CALLOUT_MAX).map((partId) => {
      const element = document.createElement('div');
      element.className = 'callout';
      element.setAttribute('data-callout', byId.get(partId)?.name ?? '');
      element.textContent = texts.get(partId) ?? byId.get(partId)?.name ?? '';
      const tether = document.createElement('div');
      tether.className = 'callout-tether';
      const marker = document.createElement('div');
      marker.className = 'callout-marker';
      this.layer.append(tether, marker, element);
      if (!immediate) element.style.opacity = '0';
      return { element, tether, marker, partId };
    });
    if (!immediate) this.fadeIn();
    this.place();
  }

  hide(immediate: boolean): void {
    if (immediate) {
      this.layer.replaceChildren();
      this.shown = [];
      return;
    }
    const leaving = this.shown;
    this.shown = [];
    this.fading = true;
    const started = performance.now();
    addFrameTask((now) => {
      const fraction = Math.min(1, (now - started) / MOTION.callouts);
      for (const item of leaving) item.element.style.opacity = String(1 - fraction);
      if (fraction < 1) return true;
      for (const item of leaving) item.element.remove();
      for (const item of leaving) item.tether.remove();
      for (const item of leaving) item.marker.remove();
      this.fading = false;
      return false;
    });
  }

  get isFading(): boolean {
    return this.fading;
  }

  private fadeIn(): void {
    const started = performance.now();
    const items = this.shown;
    addFrameTask((now) => {
      const fraction = Math.min(1, (now - started) / MOTION.callouts);
      for (const item of items) item.element.style.opacity = String(fraction);
      return fraction < 1;
    });
  }

  private place(): void {
    if (this.shown.length === 0) return;
    const bounds = this.layer.getBoundingClientRect();
    const taken: { top: number; bottom: number }[] = [];
    for (const item of this.shown) {
      const anchor = this.stage.anchorOf(item.partId);
      if (anchor === null) continue;
      const localX = anchor.x - bounds.left;
      const localY = anchor.y - bounds.top;
      const width = item.element.offsetWidth || 160;
      const flip = localX + 90 + width > bounds.width;
      const boxX = flip ? Math.max(0, localX - 90 - width) : Math.min(bounds.width - width, localX + 90);
      const height = item.element.offsetHeight || 32;
      let boxY = Math.max(0, Math.min(bounds.height - height, localY - 16));
      /* Nudge a callout clear of one already placed, so they never stack. */
      for (const other of taken) {
        if (boxY < other.bottom && boxY + height > other.top) {
          boxY = Math.min(bounds.height - height, other.bottom + 6);
        }
      }
      taken.push({ top: boxY, bottom: boxY + height });
      item.element.style.left = `${boxX}px`;
      item.element.style.top = `${boxY}px`;
      item.element.setAttribute('data-part-hidden', anchor.hidden ? 'true' : 'false');
      item.marker.style.left = `${localX - 5}px`;
      item.marker.style.top = `${localY - 5}px`;
      item.marker.style.background = anchor.hidden ? 'transparent' : 'currentColor';
      const endX = flip ? boxX + width : boxX;
      const endY = boxY + 16;
      const length = Math.hypot(endX - localX, endY - localY);
      item.tether.style.left = `${localX}px`;
      item.tether.style.top = `${localY}px`;
      item.tether.style.width = `${length}px`;
      item.tether.style.transform = `rotate(${Math.atan2(endY - localY, endX - localX)}rad)`;
    }
  }
}

const MOTION_CALLOUT_MAX = 6;
