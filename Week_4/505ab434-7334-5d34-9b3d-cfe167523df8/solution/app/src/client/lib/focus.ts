import { useEffect } from "react";

/**
 * Moves focus to the screen's level-1 heading once its content is ready (brief: Request page and decisions).
 * A reader who has already put focus on a control in the screen keeps it: late data never steals focus.
 */
export function useHeadingFocus(ready = true): void {
  useEffect(() => {
    if (!ready) return;
    const main = document.querySelector<HTMLElement>("main");
    if (main && document.activeElement !== main && main.contains(document.activeElement)) return;
    const heading = main?.querySelector<HTMLElement>("h1");
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  }, [ready]);
}

/** Sets the document title for a screen. */
export function useTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} · Quenby & Co. Rulehouse`;
  }, [title]);
}
