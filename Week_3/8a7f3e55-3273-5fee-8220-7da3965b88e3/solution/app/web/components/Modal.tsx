import { type ReactNode, useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE = 'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])';

function tabStops(root: HTMLElement): HTMLElement[] {
  const candidates = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => !(element as HTMLButtonElement).disabled && element.getClientRects().length > 0,
  );
  const radioGroups = new Map<string, HTMLInputElement[]>();
  for (const element of candidates) {
    if (element instanceof HTMLInputElement && element.type === "radio") {
      const group = radioGroups.get(element.name) ?? [];
      group.push(element);
      radioGroups.set(element.name, group);
    }
  }
  return candidates.filter((element) => {
    if (!(element instanceof HTMLInputElement) || element.type !== "radio") return true;
    const group = radioGroups.get(element.name) ?? [];
    const stop = group.find((radio) => radio.checked) ?? group[0];
    return stop === element;
  });
}

let openDialogs = 0;

/** Open dialogs, oldest first: only the topmost one answers keys and the ones beneath it are inert. */
const stack: { scrim: HTMLElement }[] = [];

function syncStack(): void {
  stack.forEach((entry, index) => {
    entry.scrim.inert = index !== stack.length - 1;
  });
}

function setBackgroundInert(inert: boolean): void {
  const root = document.getElementById("root");
  if (root) root.inert = inert;
  document.documentElement.classList.toggle("modal-open", inert);
}

/** A faded-out copy of a closed dialog that plays its exit and removes itself; the real dialog is already gone. */
function playExit(dialog: HTMLElement): void {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const ghost = dialog.cloneNode(true) as HTMLElement;
  ghost.setAttribute("aria-hidden", "true");
  ghost.inert = true;
  ghost.classList.add("dialog-ghost");
  // The copy is only a picture: nothing in it may answer a role, name or id query meant for a live dialog.
  for (const element of [ghost, ...ghost.querySelectorAll<HTMLElement>("*")]) {
    for (const name of ["id", "role", "aria-label", "aria-modal", "tabindex", "data-keep", "data-detail-heading"]) element.removeAttribute(name);
  }
  const bounds = dialog.getBoundingClientRect();
  Object.assign(ghost.style, { top: `${bounds.top}px`, left: `${bounds.left}px`, width: `${bounds.width}px`, height: `${bounds.height}px`, margin: "0", inset: "auto" });
  document.body.append(ghost);
  const animation = ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, easing: "cubic-bezier(0.65, 0, 0.35, 1)", fill: "forwards" });
  animation.finished.then(() => ghost.remove(), () => ghost.remove());
}

interface ModalProps {
  /** The dialog's accessible name. */
  label: string;
  onClose: () => void;
  /** False while a request that must finish is pending: Escape then does nothing. */
  closable?: boolean;
  /** The element to focus on open; the first control when absent. Returning null leaves focus on the dialog. */
  initialFocus?: (dialog: HTMLElement) => HTMLElement | null;
  /** Where focus lands when the opener is gone. */
  fallbackFocus: () => HTMLElement | null;
  children: ReactNode;
}

export function Modal({ label, onClose, closable = true, initialFocus, fallbackFocus, children }: ModalProps): ReactNode {
  const dialogRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const entryRef = useRef<{ scrim: HTMLElement } | null>(null);
  const openerRef = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);
  const latest = useRef({ onClose, closable, fallbackFocus });
  latest.current = { onClose, closable, fallbackFocus };

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return undefined;
    openDialogs += 1;
    setBackgroundInert(true);
    const entry = { scrim: scrimRef.current as HTMLElement };
    entryRef.current = entry;
    stack.push(entry);
    syncStack();
    const first = initialFocus ? initialFocus(dialog) : (tabStops(dialog)[0] ?? null);
    (first ?? dialog).focus();
    const opener = openerRef.current;
    return () => {
      openDialogs -= 1;
      if (openDialogs === 0) setBackgroundInert(false);
      stack.splice(stack.indexOf(entry), 1);
      syncStack();
      playExit(dialog);
      queueMicrotask(() => {
        if (document.activeElement !== document.body && document.activeElement !== null) return;
        const target = opener?.isConnected ? opener : latest.current.fallbackFocus();
        target?.focus();
      });
    };
    // The initial focus is chosen once, when the dialog opens.
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && stack[stack.length - 1] === entryRef.current) {
        event.preventDefault();
        if (latest.current.closable) latest.current.onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const wrapTab = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab" || dialogRef.current === null) return;
    const stops = tabStops(dialogRef.current);
    const firstStop = stops[0];
    const lastStop = stops[stops.length - 1];
    if (firstStop === undefined || lastStop === undefined) {
      event.preventDefault();
      return;
    }
    const active = document.activeElement;
    if (event.shiftKey && (active === firstStop || active === dialogRef.current)) {
      event.preventDefault();
      lastStop.focus();
    } else if (!event.shiftKey && active === lastStop) {
      event.preventDefault();
      firstStop.focus();
    }
  };

  const host = document.getElementById("dialogs");
  if (host === null) throw new Error("#dialogs is missing from index.html");
  return createPortal(
    <div ref={scrimRef} className="scrim">
      <div ref={dialogRef} className="dialog" role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} onKeyDown={wrapTab}>
        {children}
      </div>
    </div>,
    host,
  );
}
