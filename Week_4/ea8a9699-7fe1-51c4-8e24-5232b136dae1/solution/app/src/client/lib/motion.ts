// Graded motion (brief: Motion and effects), all through the Web Animations API with one easing that starts
// fast and settles without overshoot. Each motion has its reduced-motion substitute here.

export const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";
export const MS = { dock: 420, dockFade: 160, flight: 420, stillFade: 125, roll: 160, addRow: 240, shift: 160, panel: 200 } as const;

export const reducedMotion = (): boolean => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Strip dock: rises from below into place, or sinks on close. Reduced motion fades in place. */
export function dock(el: HTMLElement, opening: boolean): Animation {
  if (reducedMotion()) {
    return el.animate([{ opacity: opening ? 0 : 1 }, { opacity: opening ? 1 : 0 }], { duration: MS.dockFade, easing: "linear", fill: "forwards" });
  }
  const hidden = { transform: "translateY(100%)" };
  const shown = { transform: "translateY(0)" };
  return el.animate(opening ? [hidden, shown] : [shown, hidden], { duration: MS.dock, easing: EASE, fill: "forwards" });
}

/** Menu and tray panel; reduced motion shows and hides at once. */
export function panel(el: HTMLElement, opening: boolean, fromY: number): Animation | null {
  el.getAnimations().forEach((a) => a.cancel());
  if (reducedMotion()) return null;
  const hidden = { opacity: 0, transform: `translateY(${fromY}px)` };
  const shown = { opacity: 1, transform: "translateY(0)" };
  return el.animate(opening ? [hidden, shown] : [shown, hidden], { duration: MS.panel, easing: EASE, fill: "forwards" });
}

/** Moves `tile` (fixed-position, placed at `from`) onto `to`, scaling to its size. */
export function fly(tile: HTMLElement, from: DOMRect, to: DOMRect, backwards = false): Animation {
  const at = { transform: "translate(0, 0) scale(1, 1)" };
  const there = {
    transform: `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${to.width / from.width}, ${to.height / from.height})`,
  };
  return tile.animate(backwards ? [there, at] : [at, there], { duration: MS.flight, easing: EASE, fill: "forwards" });
}

export function fadeIn(el: HTMLElement, duration: number): void {
  el.animate([{ opacity: 0 }, { opacity: 1 }], { duration, easing: "linear" });
}

/** A new tray row slides in at the end of the list. */
export function slideIn(el: HTMLElement): void {
  if (reducedMotion()) return;
  el.animate([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "translateY(0)" }], { duration: MS.addRow, easing: EASE });
}

/** Layout tops of the rows, unaffected by any slide still running. */
export function layoutTops(rows: Map<string, HTMLElement>): Map<string, number> {
  return new Map([...rows].map(([id, el]) => [id, el.offsetTop]));
}

/**
 * FLIP: rows whose layout slot changed since `before` slide from where they are on screen now to the new slot.
 * Rows that kept their slot keep any slide already running; `skip` is a row the pointer is carrying.
 */
export function flip(rows: Map<string, HTMLElement>, before: Map<string, number>, skip: string | null): void {
  if (reducedMotion()) return;
  for (const [id, el] of rows) {
    const old = before.get(id);
    if (old === undefined || old === el.offsetTop || id === skip) continue;
    const running = el.getBoundingClientRect().top;
    el.getAnimations().forEach((a) => a.cancel());
    const dy = running - el.getBoundingClientRect().top + old - el.offsetTop;
    if (Math.abs(dy) < 0.5) continue;
    el.animate([{ transform: `translateY(${dy}px)` }, { transform: "translateY(0)" }], { duration: MS.shift, easing: EASE });
  }
}

/** Resolves once every row has finished sliding into its slot. */
export async function slidesDone(rows: Map<string, HTMLElement>): Promise<void> {
  await Promise.allSettled([...rows.values()].flatMap((el) => el.getAnimations().map((a) => a.finished)));
}

/** Ends every slide at once, so slot geometry read next is the layout's. */
export function settle(rows: Map<string, HTMLElement>): void {
  rows.forEach((el) => el.getAnimations().forEach((a) => a.finish()));
}
