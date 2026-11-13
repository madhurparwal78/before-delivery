export const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";
export const SWAP_MS = 360;
export const SWAP_HALF_MS = 180;
export const TILE_SLIDE_PX = 32;
export const SCREEN_SLIDE_PX = 48;
export const SCREEN_SLIDE_MS = 240;
export const DIALOG_SLIDE_PX = 40;
export const DIALOG_IN_MS = 200;
export const DIALOG_OUT_MS = 120;
const ROW_MS = 200;

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** The row's rectangles by key, taken before a change so the rows that move can slide to their new places. */
export function measureRows(list: HTMLElement | null): Map<string, DOMRect> {
  const rects = new Map<string, DOMRect>();
  if (!list) return rects;
  for (const row of list.querySelectorAll<HTMLElement>(":scope > [data-row]")) {
    rects.set(row.dataset.row ?? "", row.getBoundingClientRect());
  }
  return rects;
}

export function slideRowsFrom(list: HTMLElement | null, before: Map<string, DOMRect>): void {
  if (!list || prefersReducedMotion()) return;
  for (const row of list.querySelectorAll<HTMLElement>(":scope > [data-row]")) {
    const was = before.get(row.dataset.row ?? "");
    if (!was) continue;
    const now = row.getBoundingClientRect();
    const dy = was.top - now.top;
    if (Math.abs(dy) < 1) continue;
    row.animate(
      [{ transform: `translateY(${dy}px)` }, { transform: "translateY(0)" }],
      { duration: ROW_MS, easing: EASE },
    );
  }
}

/** Slides a row out to the left by its own width while it fades; resolves once it has left. */
export async function slideRowOut(row: HTMLElement): Promise<void> {
  if (prefersReducedMotion()) return;
  const width = row.getBoundingClientRect().width;
  const leaving = row.animate(
    [
      { transform: "translateX(0)", opacity: 1 },
      { transform: `translateX(${-width}px)`, opacity: 0 },
    ],
    { duration: ROW_MS, easing: EASE, fill: "forwards" },
  );
  await leaving.finished;
}
