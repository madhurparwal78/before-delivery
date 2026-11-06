// Modal dialogs and sheets (focus trap and return adapted from kit/modules/a11y_dialog), and the popover.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { reducedMotion } from "../hooks";

const FOCUSABLE = "button:not([disabled]), [href], input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest("[inert]"));
}

/** Tab and Shift+Tab wrap inside `root`. */
function trapTab(event: KeyboardEvent, root: HTMLElement): void {
  if (event.key !== "Tab") return;
  const items = focusables(root);
  if (!items.length) {
    event.preventDefault();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !root.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !root.contains(active))) {
    event.preventDefault();
    first.focus();
  }
}

interface DialogProps {
  label: string;
  onClose: () => void;
  /** Escape's own behaviour (the held upload and Session ending define theirs). */
  onEscape?: () => void;
  children: ReactNode;
  className?: string;
  /** Element to focus first; defaults to the first field or button. */
  initialFocus?: string;
  /** Sliding out: no backdrop, no pointer capture, focus already back on the opener. */
  closing?: boolean;
  panelRef?: React.MutableRefObject<HTMLDivElement | null>;
}

/** Open dialogs, topmost last: only the topmost one answers Escape and keeps Tab inside itself. */
const openDialogs: symbol[] = [];

export function Dialog({ label, onClose, onEscape, children, className = "dialog", initialFocus, closing = false, panelRef }: DialogProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const opener = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);
  const handlers = useRef({ onClose, onEscape, closing });
  handlers.current = { onClose, onEscape, closing };
  useEffect(() => {
    const me = Symbol(label);
    openDialogs.push(me);
    const onKey = (e: KeyboardEvent) => {
      const root = ref.current;
      if (openDialogs[openDialogs.length - 1] !== me || e.defaultPrevented || !root || handlers.current.closing) return;
      if (e.key === "Escape") {
        e.preventDefault();
        (handlers.current.onEscape ?? handlers.current.onClose)();
      } else trapTab(e, root);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      openDialogs.splice(openDialogs.indexOf(me), 1);
    };
  }, [label]);
  useLayoutEffect(() => {
    const root = ref.current!;
    const first = (initialFocus && root.querySelector<HTMLElement>(initialFocus)) || focusables(root)[0] || root;
    first.focus();
    const returnTo = opener.current;
    return () => {
      if (returnTo && returnTo.isConnected) returnTo.focus();
    };
  }, []);
  useEffect(() => {
    if (closing && opener.current?.isConnected) opener.current.focus();
  }, [closing]);
  return createPortal(
    <>
      {!closing && <div className="backdrop" onClick={onClose} />}
      <div
        ref={(el) => {
          ref.current = el;
          if (panelRef) panelRef.current = el;
        }}
        style={closing ? { pointerEvents: "none" } : undefined}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={className}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}

/**
 * A slide-over sheet: slides in from the right, slides out on close, and is unmounted once closed.
 * Opening it again while it is still sliding out keeps it open.
 */
export function Sheet({ open, label, onClose, children, full = false }: { open: boolean; label: string; onClose: () => void; children: ReactNode; full?: boolean }) {
  const [mounted, setMounted] = useState(open);
  const panel = useRef<HTMLDivElement | null>(null);
  const exit = useRef<Animation | null>(null);
  useEffect(() => {
    if (open) {
      exit.current?.cancel();
      exit.current = null;
      setMounted(true);
      return;
    }
    if (!mounted) return;
    const el = panel.current;
    if (!el || reducedMotion()) {
      setMounted(false);
      return;
    }
    const animation = el.animate([{ transform: "translateX(0)" }, { transform: "translateX(100%)" }], { duration: 180, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)", fill: "forwards" });
    exit.current = animation;
    animation.finished.then(() => {
      if (exit.current === animation) {
        exit.current = null;
        setMounted(false);
      }
    }, () => undefined);
  }, [open]);
  useLayoutEffect(() => {
    if (!mounted || !panel.current || reducedMotion()) return;
    panel.current.animate([{ transform: "translateX(100%)" }, { transform: "translateX(0)" }], { duration: 180, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" });
  }, [mounted]);
  if (!mounted) return null;
  return (
    <Dialog label={label} onClose={onClose} className={full ? "sheet full" : "sheet"} closing={!open} panelRef={panel}>
      <div className="sheet-head">
        <h2>{label}</h2>
        <button type="button" onClick={onClose}>Close</button>
      </div>
      {children}
    </Dialog>
  );
}

/** A non-modal popover beside its button, kept inside the viewport; Escape or a click outside closes it. */
export function Popover({ anchor, label, onClose, children }: { anchor: HTMLElement; label: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const a = anchor.getBoundingClientRect();
    const box = ref.current!.getBoundingClientRect();
    const margin = 8;
    let left = a.right + margin;
    let top = a.top;
    if (left + box.width > window.innerWidth - margin) {
      left = Math.max(margin, Math.min(a.left, window.innerWidth - box.width - margin));
      top = a.bottom + margin;
    }
    if (top + box.height > window.innerHeight - margin) top = Math.max(margin, a.top - box.height - margin);
    setPlace({ left, top });
  }, [anchor]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        anchor.focus();
      }
    };
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node) && !anchor.contains(e.target as Node)) {
        onClose();
        anchor.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [anchor, onClose]);
  return createPortal(
    <div ref={ref} role="dialog" aria-label={label} className="popover" style={place ? { left: place.left, top: place.top } : { left: 0, top: 0, visibility: "hidden" }}>
      {children}
    </div>,
    document.body,
  );
}
