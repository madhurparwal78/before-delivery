// Scroll-linked values: page fraction and window progress, decided here.
export type ScrollUpdate = (pageFraction: number, scrollY: number) => void;

const listeners = new Set<ScrollUpdate>();
let rafPending = false;
let lastY = -1;

export function onScroll(fn: ScrollUpdate): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(): void {
  rafPending = false;
  const doc = document.documentElement;
  const scrollY = window.scrollY;
  const max = Math.max(1, doc.scrollHeight - window.innerHeight);
  const pageFraction = clamp(scrollY / max, 0, 1);
  for (const fn of listeners) fn(pageFraction, scrollY);
}

function request(): void {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(emit);
}

export function startScrollEngine(): void {
  window.addEventListener('scroll', request, { passive: true });
  window.addEventListener('resize', request);
  request();
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

// Page fraction: 0 at the very top, 1 at the very bottom.
export function pageFraction(): number {
  const doc = document.documentElement;
  const max = Math.max(1, doc.scrollHeight - window.innerHeight);
  return clamp(window.scrollY / max, 0, 1);
}

// Window progress for a tall window: 0 when its top edge is at the top of the
// screen and 1 when its bottom edge is at the bottom of the screen.
export function windowProgress(el: Element): number {
  const rect = el.getBoundingClientRect();
  const vh = window.innerHeight;
  const h = rect.height;
  if (h <= vh) {
    // A viewport-sized window progresses as it leaves the screen.
    return clamp((vh - rect.top) / (vh + h) * 2, 0, 1);
  }
  return clamp(-rect.top / (h - vh), 0, 1);
}

// q for the brightness dial: 0 when the top reaches the bottom of the screen,
// 1 when the bottom reaches the top.
export function throughScreen(el: Element): number {
  const rect = el.getBoundingClientRect();
  const vh = window.innerHeight;
  return clamp((vh - rect.top) / (rect.height + vh), 0, 1);
}
