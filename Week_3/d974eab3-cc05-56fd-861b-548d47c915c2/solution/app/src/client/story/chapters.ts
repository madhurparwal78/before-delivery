import { reducedMotion } from "../motion.js";

export const CHAPTERS = [
  { id: "opening", title: "Opening" },
  { id: "about", title: "About" },
  { id: "oxygen", title: "Oxygen & Energy" },
  { id: "science", title: "Science & Technology" },
  { id: "product", title: "Product" },
  { id: "interviews", title: "Interviews" },
  { id: "lifestyle", title: "Lifestyle" },
] as const;

export type ChapterId = (typeof CHAPTERS)[number]["id"];

function isChapterId(value: string): value is ChapterId {
  return CHAPTERS.some((chapter) => chapter.id === value);
}

/** The rail and menu name of a chapter is its two-digit number, one space, then its title. */
export function chapterNumber(index: number): string {
  return String(index + 1).padStart(2, "0");
}

export function chapterFromHash(hash: string): ChapterId | null {
  const id = hash.replace(/^#/, "");
  return isChapterId(id) ? id : null;
}

/** The point of the viewport that decides the current chapter, as a share of its height. */
const READING_LINE = 0.4;
const JUMP_MS_PER_PIXEL = 0.25;
const JUMP_MIN_MS = 260;
const JUMP_MAX_MS = 620;

/** Starts quickly and settles softly, like the other published motions. */
function settle(progress: number): number {
  return 1 - (1 - progress) ** 4;
}

/** Tracks the current chapter, keeps the address hash on it and moves between chapters. */
export class ChapterWatcher {
  private current: ChapterId | null = null;
  private frame = 0;
  private travelling = false;

  constructor(
    private readonly regions: ReadonlyMap<ChapterId, HTMLElement>,
    private readonly show: (id: ChapterId) => void,
    signal: AbortSignal,
  ) {
    const follow = (): void => this.sync();
    addEventListener("scroll", follow, { passive: true, signal });
    addEventListener("resize", follow, { signal });
    const interrupt = (): void => this.stop();
    addEventListener("wheel", interrupt, { passive: true, signal });
    addEventListener("touchstart", interrupt, { passive: true, signal });
    signal.addEventListener("abort", () => cancelAnimationFrame(this.frame));
  }

  /** The current chapter is the last one whose top edge is above the reading line. */
  private chapterAtReadingLine(): ChapterId {
    const line = innerHeight * READING_LINE;
    let found: ChapterId = "opening";
    for (const [id, region] of this.regions) {
      if (region.getBoundingClientRect().top <= line) found = id;
    }
    return found;
  }

  sync(): void {
    if (this.travelling) return;
    this.apply(this.chapterAtReadingLine());
  }

  private apply(id: ChapterId): void {
    if (id !== this.current) {
      this.current = id;
      this.show(id);
    }
    const hash = `#${id}`;
    if (location.hash !== hash) history.replaceState(null, "", `${location.pathname}${location.search}${hash}`);
  }

  private stop(): void {
    if (!this.travelling) return;
    cancelAnimationFrame(this.frame);
    this.travelling = false;
    this.sync();
  }

  /** Brings a chapter's heading clear of the header with focus on it. */
  jump(id: ChapterId, instant: boolean): void {
    const region = this.regions.get(id);
    const heading = region?.querySelector("h1, h2");
    if (!region || !(heading instanceof HTMLElement)) return;
    cancelAnimationFrame(this.frame);
    heading.focus({ preventScroll: true });
    const maximum = document.documentElement.scrollHeight - innerHeight;
    const target = Math.min(maximum, Math.max(0, region.getBoundingClientRect().top + scrollY));
    const from = scrollY;
    const duration = Math.min(JUMP_MAX_MS, Math.max(JUMP_MIN_MS, Math.abs(target - from) * JUMP_MS_PER_PIXEL));
    if (instant || reducedMotion() || Math.abs(target - from) < 1) {
      this.travelling = false;
      scrollTo({ top: target, behavior: "instant" });
      this.apply(id);
      return;
    }
    this.travelling = true;
    this.apply(id);
    let startedAt: number | null = null;
    const step = (now: number): void => {
      startedAt ??= now;
      const progress = Math.min(1, (now - startedAt) / duration);
      scrollTo({ top: from + (target - from) * settle(progress), behavior: "instant" });
      if (progress < 1) {
        this.frame = requestAnimationFrame(step);
      } else {
        this.travelling = false;
        this.sync();
      }
    };
    this.frame = requestAnimationFrame(step);
  }
}
