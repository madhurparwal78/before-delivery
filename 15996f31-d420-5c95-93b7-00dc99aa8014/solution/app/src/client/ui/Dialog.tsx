// A modal dialog (contract from kit/modules/a11y_dialog): focus goes to the first field, Tab cycles inside,
// Escape or the close button shuts it and focus returns to the control that opened it. The app shell behind is
// inert while any dialog is open; the live regions are outside the shell and keep speaking.

import { X } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { prefersReducedMotion } from "../hooks.js";

let openDialogs = 0;

/** Marks the app shell inert while any dialog is open; set directly so focus can return in the same task. */
function holdShell(delta: number): void {
  openDialogs += delta;
  const shell = document.querySelector<HTMLElement>(".shell");
  if (shell) shell.inert = openDialogs > 0;
}

const FOCUSABLE = "button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])";
const FIELDS = "input:not([disabled]):not([type=hidden]):not([type=file]), select:not([disabled]), textarea:not([disabled])";

const ENTER = { duration: 250, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" };
const LEAVE = { duration: 170, easing: "ease-in" };

interface DialogProps {
  title: string;
  open: boolean;
  onClose: () => void;
  /** The control that opened the dialog; focus returns here when it closes. */
  opener: HTMLElement | null;
  children: ReactNode;
  wide?: boolean;
}

export function Dialog({ title, open, onClose, opener, children, wide }: DialogProps) {
  const [mounted, setMounted] = useState(open);
  const panel = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const returnTo = useRef<HTMLElement | null>(null);
  const holding = useRef(false);

  useEffect(() => {
    if (open) {
      returnTo.current = opener;
      setMounted(true);
    }
  }, [open, opener]);

  useLayoutEffect(() => {
    if (!mounted) return;
    holdShell(1);
    holding.current = true;
    return () => {
      if (holding.current) holdShell(-1);
      holding.current = false;
    };
  }, [mounted]);

  useLayoutEffect(() => {
    if (!mounted || !open || !panel.current) return;
    const first = panel.current.querySelector<HTMLElement>(FIELDS) ?? panel.current.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    if (!prefersReducedMotion()) {
      panel.current.animate([{ opacity: 0, translate: "0 8px" }, { opacity: 1, translate: "0 0" }], ENTER);
      backdrop.current?.animate([{ opacity: 0 }, { opacity: 1 }], ENTER);
    }
  }, [mounted, open]);

  useEffect(() => {
    if (open || !mounted) return;
    // Closing hands the page back at once: the shell is live, focus is on the opener, and the fading layer
    // takes no clicks. The layer unmounts when the fade ends.
    if (holding.current) holdShell(-1);
    holding.current = false;
    const target = returnTo.current;
    if (target && target.isConnected) target.focus();
    if (prefersReducedMotion() || !panel.current) {
      setMounted(false);
      return;
    }
    const leaving = panel.current.animate([{ opacity: 1, translate: "0 0" }, { opacity: 0, translate: "0 8px" }], { ...LEAVE, fill: "forwards" });
    backdrop.current?.animate([{ opacity: 1 }, { opacity: 0 }], { ...LEAVE, fill: "forwards" });
    leaving.onfinish = () => setMounted(false);
    return () => {
      leaving.onfinish = null;
    };
  }, [open, mounted]);

  if (!mounted) return null;

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !panel.current) return;
    const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((item) => item.offsetParent !== null || item === document.activeElement);
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !panel.current.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !panel.current.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div className={`dialog-layer${open ? "" : " is-leaving"}`} onKeyDown={onKeyDown}>
      <div className="dialog-backdrop" ref={backdrop} onClick={onClose} />
      <div ref={panel} className={`dialog${wide ? " dialog-wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="dialog-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label={`Close ${title}`}>
            <X aria-hidden="true" size={20} strokeWidth={1.5} />
          </button>
        </header>
        <div className="dialog-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
