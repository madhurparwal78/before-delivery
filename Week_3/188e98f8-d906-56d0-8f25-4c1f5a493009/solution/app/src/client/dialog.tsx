import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import { EASING, MS, PANE_HOLD_MS, prefersReducedMotion } from "./motion";

const TABBABLE = 'a[href], button, input, select, textarea, [tabindex]';

function isTabbable(element: HTMLElement): boolean {
  if ((element as HTMLButtonElement).disabled || element.getAttribute("tabindex") === "-1") return false;
  if (element.getAttribute("type") === "hidden") return false;
  return element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden";
}

/** Tab stops of a dialog in document order; a radio group is one stop, on its checked radio or its first. */
function tabStops(root: HTMLElement): HTMLElement[] {
  const stops: HTMLElement[] = [];
  const groups = new Set<string>();
  for (const element of root.querySelectorAll<HTMLElement>(TABBABLE)) {
    if (!isTabbable(element)) continue;
    if (element instanceof HTMLInputElement && element.type === "radio" && element.name !== "") {
      if (groups.has(element.name)) continue;
      groups.add(element.name);
      const checked = root.querySelector<HTMLInputElement>(`input[type=radio][name="${CSS.escape(element.name)}"]:checked`);
      stops.push(checked ?? element);
      continue;
    }
    stops.push(element);
  }
  return stops;
}

interface DialogProps {
  open: boolean;
  /** Visible heading, and so the accessible name. */
  label: string;
  onRequestClose: () => void;
  /** First stop when the dialog opens; the first tab stop when absent. */
  initialFocus?: (panel: HTMLElement) => HTMLElement | null;
  /** Where focus goes when the dialog starts to close; the element focused at open when absent. */
  closeFocus?: () => HTMLElement | null;
  /** Shortcuts that work whichever control in the dialog has focus. */
  onShortcut?: (event: ReactKeyboardEvent<HTMLElement>) => void;
  children: ReactNode;
}

function playIn(panel: HTMLElement, backdrop: HTMLElement): void {
  const reduced = prefersReducedMotion();
  const wide = window.matchMedia("(min-width: 768px)").matches;
  if (reduced) {
    const options: KeyframeAnimationOptions = { duration: MS.reduced, easing: EASING, fill: "backwards" };
    panel.animate([{ opacity: 0 }, { opacity: 1 }], options);
    backdrop.animate([{ opacity: 0 }, { opacity: 1 }], options);
    return;
  }
  // The 600ms run opens with a short rest at the start position (DESIGN.md Motion, pane hold), then
  // eases to rest; the curve is on the second keyframe segment so the rest is in time, not in progress.
  const hold = PANE_HOLD_MS / MS.pane;
  const options: KeyframeAnimationOptions = { duration: MS.pane, easing: "linear", fill: "backwards" };
  const hidden = wide ? "translateX(100%)" : "translateY(100%)";
  panel.animate(
    [
      { transform: hidden, offset: 0 },
      { transform: hidden, offset: hold, easing: EASING },
      { transform: "none", offset: 1 },
    ],
    options,
  );
  backdrop.animate(
    [
      { opacity: 0, offset: 0 },
      { opacity: 0, offset: hold, easing: EASING },
      { opacity: 1, offset: 1 },
    ],
    options,
  );
}

function playOut(panel: HTMLElement, backdrop: HTMLElement): Animation {
  const reduced = prefersReducedMotion();
  const wide = window.matchMedia("(min-width: 768px)").matches;
  const options: KeyframeAnimationOptions = { duration: reduced ? MS.reduced : MS.pane, easing: EASING, fill: "forwards" };
  const gone = reduced ? { opacity: 0 } : wide ? { transform: "translateX(100%)" } : { transform: "translateY(100%)" };
  const there = reduced ? { opacity: 1 } : { transform: "none" };
  backdrop.animate([{ opacity: 1 }, { opacity: 0 }], options);
  return panel.animate([there, gone], options);
}

/**
 * A pane (768px and wider) or a full-screen sheet. While open the app behind it is inert and Tab
 * wraps inside it; closing starts the exit at once, returns focus, and removes the dialog when
 * the exit finishes. Reopening during the exit stops it and leaves the dialog fully open.
 */
export function Dialog({ open, label, onRequestClose, initialFocus, closeFocus, onShortcut, children }: DialogProps) {
  const [mounted, setMounted] = useState(false);
  const [openings, setOpenings] = useState(0);
  const panel = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const generation = useRef(0);
  const isMounted = useRef(false);
  const heading = useId();

  isMounted.current = mounted;

  useLayoutEffect(() => {
    if (open) {
      generation.current += 1;
      if (!isMounted.current) opener.current = document.activeElement as HTMLElement | null;
      setMounted(true);
      setOpenings((count) => count + 1);
    } else if (isMounted.current && panel.current !== null && backdrop.current !== null) {
      const mine = ++generation.current;
      const root = document.getElementById("root");
      if (root !== null) root.inert = false;
      panel.current.inert = true;
      panel.current.classList.add("leaving");
      backdrop.current.classList.add("leaving");
      const target = closeFocus?.() ?? opener.current;
      if (target?.isConnected) target.focus();
      const exit = playOut(panel.current, backdrop.current);
      void exit.finished.then(
        () => {
          if (generation.current === mine) setMounted(false);
        },
        () => undefined,
      );
    }
  }, [open]);

  useLayoutEffect(() => {
    if (openings === 0 || panel.current === null || backdrop.current === null) return;
    for (const running of [...panel.current.getAnimations(), ...backdrop.current.getAnimations()]) running.cancel();
    panel.current.inert = false;
    panel.current.classList.remove("leaving");
    backdrop.current.classList.remove("leaving");
    const root = document.getElementById("root");
    if (root !== null) root.inert = true;
    const first = initialFocus?.(panel.current) ?? tabStops(panel.current)[0] ?? panel.current;
    first.focus();
    playIn(panel.current, backdrop.current);
  }, [openings]);

  useEffect(
    () => () => {
      const root = document.getElementById("root");
      if (root !== null) root.inert = false;
    },
    [],
  );

  if (!mounted) return null;

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onRequestClose();
      return;
    }
    if (event.key === "Tab" && panel.current !== null) {
      const stops = tabStops(panel.current);
      const first = stops[0];
      const last = stops[stops.length - 1];
      const active = document.activeElement;
      if (first === undefined || last === undefined) {
        event.preventDefault();
      } else if (!panel.current.contains(active) || active === panel.current) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
      return;
    }
    onShortcut?.(event);
  };

  return createPortal(
    <div className="layer">
      <div className="backdrop" ref={backdrop} />
      <div className="panel" role="dialog" aria-modal="true" aria-labelledby={heading} ref={panel} onKeyDown={onKeyDown} tabIndex={-1}>
        <h2 id={heading} className="panel-title">
          {label}
        </h2>
        {children}
      </div>
    </div>,
    document.getElementById("layers") as HTMLElement,
  );
}
