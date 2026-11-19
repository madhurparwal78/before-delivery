import { useEffect, useRef } from "react";

// Escape closes the top-most dialog first, then the slide-over rail, then the detail column;
// whatever closes hands focus back to the control that opened it (adapted from kit a11y_dialog).

type Kind = "dialog" | "rail" | "panel";
type Layer = { kind: Kind; close: () => void };

const stack: Layer[] = [];

function top(): Layer | undefined {
  for (const kind of ["dialog", "rail", "panel"] as const) {
    const found = stack.filter((layer) => layer.kind === kind).at(-1);
    if (found) return found;
  }
  return undefined;
}

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || event.defaultPrevented) return;
  const layer = top();
  if (!layer) return;
  event.preventDefault();
  layer.close();
});

export function useLayer(kind: Kind, close: () => void, active = true): void {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!active) return;
    const returnTo = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    const layer: Layer = { kind, close: () => closeRef.current() };
    stack.push(layer);
    return () => {
      stack.splice(stack.indexOf(layer), 1);
      if (returnTo?.isConnected) returnTo.focus({ preventScroll: true });
    };
  }, [kind, active]);
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0 && !el.hidden);
}

export function firstField(root: HTMLElement): HTMLElement | undefined {
  const field = [...root.querySelectorAll<HTMLElement>("input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled])")].find(
    (el) => el.getClientRects().length > 0 && !el.hidden,
  );
  return field ?? focusables(root)[0];
}
