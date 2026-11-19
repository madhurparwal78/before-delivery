import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { prefersReducedMotion } from "../layout";

// Adapted from kit/modules/a11y_dialog: focus moves to the first control, Tab and Shift+Tab wrap inside,
// Escape closes, and closing by any means returns focus to the opener. While a dialog is open everything
// outside it is inert, except live regions marked `data-live-outside`, which stay announced.

const CANDIDATES = "button, [href], input, select, textarea, audio[controls], [tabindex]:not([tabindex='-1']), [contenteditable='true']";

/** The Tab stops inside a root: enabled controls in document order, one stop per radio group. */
function tabStops(root: HTMLElement): HTMLElement[] {
  const seenGroups = new Set<string>();
  const stops: HTMLElement[] = [];
  for (const element of root.querySelectorAll<HTMLElement>(CANDIDATES)) {
    if (element.matches(":disabled") || element.closest("[hidden], [inert]") || element.getClientRects().length === 0) continue;
    if (element instanceof HTMLInputElement && element.type === "radio") {
      if (seenGroups.has(element.name)) continue;
      const group = [...root.querySelectorAll<HTMLInputElement>(`input[type=radio][name="${CSS.escape(element.name)}"]`)];
      seenGroups.add(element.name);
      stops.push(group.find((radio) => radio.checked) ?? element);
      continue;
    }
    stops.push(element);
  }
  return stops;
}

/** Makes every element outside `keep` inert (siblings along the path to the body) and returns the undo. */
function inertOutside(keep: HTMLElement): () => void {
  const changed: HTMLElement[] = [];
  const live = [...document.querySelectorAll<HTMLElement>("[data-live-outside]")];
  for (let node: HTMLElement | null = keep; node && node !== document.body; node = node.parentElement) {
    for (const sibling of node.parentElement?.children ?? []) {
      if (!(sibling instanceof HTMLElement) || sibling === node || sibling.inert || sibling instanceof HTMLScriptElement) continue;
      if (live.some((region) => sibling.contains(region))) continue;
      sibling.inert = true;
      changed.push(sibling);
    }
  }
  return () => {
    for (const element of changed) element.inert = false;
  };
}

interface DialogProps {
  open: boolean;
  title: string;
  onDismiss: () => void;
  returnFocus: () => HTMLElement | null;
  className?: string;
  /** Rendered in place and kept in the page while closed (hidden and inert), as the phone's dreamscape sheet is. */
  persistent?: boolean;
  children: ReactNode;
}

const ENTER = { duration: 250, easing: "cubic-bezier(0.16, 1, 0.3, 1)" };
const LEAVE = { duration: 180, easing: "cubic-bezier(0.16, 1, 0.3, 1)" };

export function Dialog({ open, title, onDismiss, returnFocus, className = "", persistent = false, children }: DialogProps) {
  // `leaving` keeps a closed dialog painted for its exit fade; it has already left the accessibility tree.
  const [leaving, setLeaving] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const wasOpen = useRef(open);

  useLayoutEffect(() => {
    const element = panel.current;
    if (!open || !element) return;
    const restore = inertOutside(element.parentElement ?? element);
    tabStops(element)[0]?.focus();
    if (!prefersReducedMotion()) {
      element.animate([{ opacity: 0, transform: "translateY(12px)" }, { opacity: 1, transform: "none" }], ENTER);
    }
    return restore;
  }, [open]);

  useEffect(() => {
    if (wasOpen.current && !open) {
      returnFocus()?.focus();
      const element = panel.current;
      if (element && !prefersReducedMotion()) {
        setLeaving(true);
        const fade = element.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(6px)" }], LEAVE);
        void fade.finished.then(() => setLeaving(false), () => setLeaving(false));
      }
    }
    wasOpen.current = open;
  }, [open, returnFocus]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onDismiss();
      return;
    }
    if (event.key !== "Tab" || !panel.current) return;
    const stops = tabStops(panel.current);
    event.preventDefault();
    if (stops.length === 0) return;
    const at = stops.findIndex((stop) => stop === document.activeElement || stop.contains(document.activeElement));
    const next = event.shiftKey ? (at <= 0 ? stops.length - 1 : at - 1) : at === -1 || at === stops.length - 1 ? 0 : at + 1;
    stops[next]?.focus();
  };

  if (!open && !leaving && !persistent) return null;
  const shown = open || leaving;
  const layer = (
    <div
      className={`scrim ${className}`}
      hidden={!shown}
      inert={!open}
      data-closing={leaving || undefined}
      onMouseDown={(event) => event.target === event.currentTarget && onDismiss()}
    >
      <div
        ref={panel}
        className="dialog"
        role={open || persistent ? "dialog" : undefined}
        aria-modal={open || undefined}
        aria-labelledby={titleId}
        aria-hidden={leaving || undefined}
        onKeyDown={onKeyDown}
      >
        <h2 id={titleId} className="dialog-title">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
  return persistent ? layer : createPortal(layer, document.body);
}
