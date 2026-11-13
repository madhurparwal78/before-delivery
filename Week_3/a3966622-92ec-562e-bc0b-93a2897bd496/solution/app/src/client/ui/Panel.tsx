// Dialogs, the Jobs drawer and the Waypoints sheet. Opening moves focus inside; Tab and Shift+Tab
// wrap within the panel; Escape closes it and focus returns to the control that opened it. Exit
// runs on page timers, and reopening during the exit keeps the panel open. A closed panel is not
// rendered at all, so none of its controls can be reached or read.
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

const EXIT_MS = 250;

/** Focusable descendants in Tab order (from kit/modules/a11y_dialog). */
function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea, [tabindex]")].filter(
    (el) =>
      !el.hasAttribute("disabled") &&
      el.getAttribute("tabindex") !== "-1" &&
      !(el instanceof HTMLInputElement && el.type === "hidden") &&
      el.getClientRects().length > 0 &&
      !(el instanceof HTMLInputElement && el.type === "radio" && !el.checked && hasCheckedPeer(root, el)),
  );
}

/** Tab reaches only the checked radio of a group that has one. */
function hasCheckedPeer(root: HTMLElement, radio: HTMLInputElement): boolean {
  return [...root.querySelectorAll<HTMLInputElement>(`input[type=radio][name="${radio.name}"]`)].some((r) => r.checked);
}

export function anyPanelOpen(): boolean {
  return document.querySelector('[data-panel][data-phase="open"]') !== null;
}

interface PanelProps {
  open: boolean;
  label: string;
  variant: "dialog" | "drawer" | "sheet";
  onClose: () => void;
  children: ReactNode;
}

export function Panel({ open, label, variant, onClose, children }: PanelProps) {
  const [phase, setPhase] = useState<"closed" | "open" | "closing">(open ? "open" : "closed");
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const exit = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (open) {
      if (phase === "closed") opener.current = document.activeElement as HTMLElement | null;
      window.clearTimeout(exit.current);
      if (phase !== "open") setPhase("open");
      return;
    }
    if (phase === "open") {
      setPhase("closing");
      if (opener.current?.isConnected) opener.current.focus();
      exit.current = window.setTimeout(() => setPhase("closed"), EXIT_MS);
    }
  }, [open, phase]);

  useLayoutEffect(() => {
    if (phase !== "open" || !panel.current || panel.current.contains(document.activeElement)) return;
    const items = focusables(panel.current);
    (panel.current.querySelector<HTMLElement>("[data-autofocus]") ?? items[0] ?? panel.current).focus();
  }, [phase]);

  useEffect(() => () => window.clearTimeout(exit.current), []);

  if (phase === "closed") return null;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !panel.current) return;
    const items = focusables(panel.current);
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) {
      event.preventDefault();
      return;
    }
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !panel.current.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !panel.current.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  };

  const closing = phase === "closing";
  return (
    <>
      <div className={`scrim scrim-${variant}`} data-phase={phase} onClick={closing ? undefined : onClose} aria-hidden="true" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        data-panel=""
        data-phase={phase}
        className={`panel panel-${variant}`}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        inert={closing}
        aria-hidden={closing || undefined}
      >
        {children}
      </div>
    </>
  );
}
