import { createPortal } from "preact/compat";
import type { ComponentChildren } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";

const EXIT_MS = 140;

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function setPageInert(on: boolean): void {
  const root = document.getElementById("app");
  if (!root) return;
  if (on) root.setAttribute("inert", "");
  else root.removeAttribute("inert");
}

export interface DialogHandle {
  open: boolean;
  show(): void;
  /** Closes the dialog; focus goes back to what opened it unless `focus` is false. */
  close(focus?: boolean): void;
}

/** State for one dialog: remembers the control that opened it and gives focus back at once on close. */
export function useDialog(): DialogHandle {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const handle = useRef<DialogHandle>({ open, show: () => undefined, close: () => undefined });
  handle.current = {
    open,
    show() {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setPageInert(true);
      setOpen(true);
    },
    close(focus = true) {
      setPageInert(false);
      setOpen(false);
      if (focus) opener.current?.focus();
    },
  };
  return {
    open,
    show: () => handle.current.show(),
    close: (focus) => handle.current.close(focus),
  };
}

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(
    (el) => !el.hasAttribute("disabled") && el.offsetParent !== null,
  );
}

interface Props {
  handle: DialogHandle;
  label: string;
  children: ComponentChildren;
}

/** A modal dialog: inert page behind it, Tab wraps inside, Escape closes, fades out in 140 ms. */
export function Dialog({ handle, label, children }: Props) {
  const [mounted, setMounted] = useState(handle.open);
  const box = useRef<HTMLDivElement>(null);
  const timer = useRef(0);

  useLayoutEffect(() => {
    window.clearTimeout(timer.current);
    if (handle.open) {
      setMounted(true);
      return;
    }
    if (!mounted) return;
    if (reducedMotion()) setMounted(false);
    else timer.current = window.setTimeout(() => setMounted(false), EXIT_MS);
    return () => window.clearTimeout(timer.current);
  }, [handle.open]);

  useLayoutEffect(() => {
    if (!handle.open || !box.current) return;
    const root = box.current;
    const first = root.querySelector<HTMLElement>("[data-initial]") ?? focusables(root)[0] ?? root;
    first.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        handle.close();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables(root);
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const firstItem = items[0]!;
      const lastItem = items[items.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && (active === firstItem || !root.contains(active))) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && (active === lastItem || !root.contains(active))) {
        event.preventDefault();
        firstItem.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [handle.open, mounted]);

  if (!mounted && !handle.open) return null;
  const host = document.getElementById("dialogs");
  if (!host) return null;
  return createPortal(
    <div class={`dialog-backdrop${handle.open ? "" : " leaving"}`} inert={!handle.open}>
      <div ref={box} role="dialog" aria-modal="true" aria-label={label} class="dialog" tabIndex={-1}>
        {children}
      </div>
    </div>,
    host,
  );
}
