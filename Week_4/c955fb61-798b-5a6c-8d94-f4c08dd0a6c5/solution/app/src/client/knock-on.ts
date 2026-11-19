import { daysBetween } from "../shared/calendar";
import type { AppConfig, Project } from "../shared/types";
import { DAY_PX } from "./chart";

const DEPTH_CAP = 12;

/** cubic-bezier(0.2, 0, 0, 1): starts quickly and settles softly. */
export function ease(progress: number): number {
  const x1 = 0.2;
  const y1 = 0;
  const x2 = 0;
  const y2 = 1;
  const axis = (a: number, b: number, t: number) => 3 * a * (1 - t) * (1 - t) * t + 3 * b * (1 - t) * t * t + t * t * t;
  let low = 0;
  let high = 1;
  for (let step = 0; step < 24; step++) {
    const middle = (low + high) / 2;
    if (axis(x1, x2, middle) < progress) low = middle;
    else high = middle;
  }
  return axis(y1, y2, (low + high) / 2);
}

interface Slide {
  id: string;
  depth: number;
  /** The old start column minus the new start column. */
  columns: number;
}

/** Fewest links from the edited item to every other item, capped at 12; items it does not reach have depth 0. */
function depths(editedId: string | null, links: readonly { from: string; to: string }[]): Map<string, number> {
  const found = new Map<string, number>();
  if (editedId === null) return found;
  found.set(editedId, 0);
  const queue = [editedId];
  for (let next = 0; next < queue.length; next++) {
    for (const link of links.filter((candidate) => candidate.from === queue[next])) {
      if (!found.has(link.to)) {
        found.set(link.to, Math.min(DEPTH_CAP, (found.get(queue[next]) ?? 0) + 1));
        queue.push(link.to);
      }
    }
  }
  return found;
}

/** The bars whose shown start changed, other than the edited one and the groups. */
export function slidesBetween(previous: Project, next: Project, editedId: string | null, links: readonly { from: string; to: string }[]): Slide[] {
  const reach = depths(editedId, links);
  return next.items.flatMap((item) => {
    const before = previous.items.find((candidate) => candidate.id === item.id);
    if (!before || item.kind === "group" || item.id === editedId || !before.start || !item.start || before.start === item.start) return [];
    return [{ id: item.id, depth: reach.get(item.id) ?? 0, columns: daysBetween(item.start, before.start) }];
  });
}

/** Runs the knock-on on the chart's elements: inline transforms, `data-motion`, from requestAnimationFrame and performance.now. */
export class KnockOn {
  private frame = 0;
  private slides: Slide[] = [];
  private finishColumns = 0;
  private startedAt = 0;
  private config: AppConfig | null = null;
  readonly offsets = new Map<string, number>();

  constructor(
    private readonly root: HTMLElement,
    private readonly onFrame: () => void,
  ) {}

  private bar(id: string): HTMLElement | null {
    return this.root.querySelector(`[data-item-id="${id}"]:not([data-baseline-bar])`);
  }

  private marker(): HTMLElement | null {
    return this.root.querySelector("#finish-marker");
  }

  /** Everything jumps to its final place. */
  settle(): void {
    cancelAnimationFrame(this.frame);
    for (const slide of this.slides) this.place(this.bar(slide.id), 0, null);
    this.place(this.marker(), 0, null);
    this.slides = [];
    this.finishColumns = 0;
    this.offsets.clear();
    this.onFrame();
  }

  private place(element: HTMLElement | null, pixels: number, motion: string | null): void {
    if (!element) return;
    element.style.transform = pixels === 0 ? "" : `translateX(${pixels}px)`;
    if (motion) element.setAttribute("data-motion", motion);
    else element.removeAttribute("data-motion");
  }

  play(config: AppConfig, slides: Slide[], finishColumns: number): void {
    this.settle();
    this.config = config;
    this.slides = slides;
    this.finishColumns = finishColumns;
    this.startedAt = performance.now();
    if (slides.length === 0 && finishColumns === 0) return;
    this.tick();
  }

  private tick = (): void => {
    const config = this.config;
    if (!config) return;
    const elapsed = performance.now() - this.startedAt;
    let slidesEnd = 0;
    for (const slide of this.slides) {
      const begin = config.knockOnStaggerMs * slide.depth;
      slidesEnd = Math.max(slidesEnd, begin + config.knockOnMs);
      const progress = Math.min(1, Math.max(0, (elapsed - begin) / config.knockOnMs));
      const pixels = slide.columns * DAY_PX * (1 - ease(progress));
      this.offsets.set(slide.id, progress >= 1 ? 0 : pixels);
      this.place(this.bar(slide.id), progress >= 1 ? 0 : pixels, progress >= 1 ? null : "knock-on");
    }
    if (this.finishColumns !== 0) {
      const progress = Math.min(1, Math.max(0, (elapsed - slidesEnd) / config.finishMotionMs));
      const pixels = this.finishColumns * DAY_PX * (1 - ease(progress));
      const moving = elapsed >= slidesEnd && progress < 1;
      this.place(this.marker(), progress >= 1 ? 0 : pixels, moving ? "finish" : null);
    }
    this.onFrame();
    const finished = elapsed >= slidesEnd && (this.finishColumns === 0 || elapsed >= slidesEnd + config.finishMotionMs);
    if (finished) {
      this.slides = [];
      this.offsets.clear();
      this.finishColumns = 0;
    } else {
      this.frame = requestAnimationFrame(this.tick);
    }
  };
}
