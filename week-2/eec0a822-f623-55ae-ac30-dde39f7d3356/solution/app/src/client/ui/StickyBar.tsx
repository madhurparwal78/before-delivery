// Sticky action bars never cover the control that was just focused: the page (or the sheet) scrolls it
// into view above the bar.
import { useEffect } from "preact/hooks";

const GAP = 16;

function lift(bar: HTMLElement, target: HTMLElement, scroller: HTMLElement | null): void {
  if (bar.contains(target)) return;
  const barTop = bar.getBoundingClientRect().top;
  const bottom = target.getBoundingClientRect().bottom;
  if (bottom <= barTop - GAP / 2) return;
  const delta = bottom - barTop + GAP;
  if (scroller) scroller.scrollBy({ top: delta, behavior: "instant" });
  else window.scrollBy({ top: delta, behavior: "instant" });
}

/** While `active`, keeps every focused control inside `root` (default: the page) above `bar`. */
export function useKeepAboveBar(bar: { current: HTMLElement | null }, active: boolean, scroller?: { current: HTMLElement | null }): void {
  useEffect(() => {
    if (!active) return;
    const onFocus = (event: FocusEvent) => {
      const el = bar.current;
      const target = event.target as HTMLElement | null;
      if (!el || !target || !(target instanceof HTMLElement)) return;
      if (scroller?.current && !scroller.current.contains(target)) return;
      lift(el, target, scroller?.current ?? null);
      queueMicrotask(() => lift(el, target, scroller?.current ?? null));
    };
    document.addEventListener("focusin", onFocus);
    return () => document.removeEventListener("focusin", onFocus);
  }, [active]);
}
