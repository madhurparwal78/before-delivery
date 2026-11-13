import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { MOTION_MS } from "../../shared/motion";
import { isReduced, usePhone } from "../lib/motion";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

let lastTrigger: HTMLElement | null = null;
document.addEventListener(
  "click",
  (event) => {
    const hit = (event.target as Element | null)?.closest<HTMLElement>("button, a[href], input, select");
    if (hit) lastTrigger = hit;
  },
  true,
);

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (node) => node.getClientRects().length > 0 && node.getAttribute("aria-hidden") !== "true",
  );
}

type Phase = "closed" | "opening" | "open" | "closing";

interface Props {
  open: boolean;
  title: string;
  onClose: () => void;
  /** Render as a bottom sheet on phones, with the `sheet` motion and swipe-down to close. */
  sheet?: boolean;
  restoreFocus?: boolean;
  initialFocus?: (root: HTMLElement) => HTMLElement | null;
  className?: string;
  children: ReactNode;
}

export function Dialog({ open, title, onClose, sheet = false, restoreFocus = true, initialFocus, className, children }: Props): ReactElement | null {
  const phone = usePhone();
  const asSheet = sheet && phone;
  const [phase, setPhase] = useState<Phase>("closed");
  const root = useRef<HTMLDivElement | null>(null);
  const surface = useRef<HTMLDivElement | null>(null);
  const body = useRef<HTMLDivElement | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const swipe = useRef<{ start: number; last: number } | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const titleId = useId();
  const wasOpen = useRef(false);

  useLayoutEffect(() => {
    const was = wasOpen.current;
    wasOpen.current = open;
    if (open && !was) {
      const active = document.activeElement as HTMLElement | null;
      opener.current = lastTrigger && lastTrigger.isConnected ? lastTrigger : active;
      if (asSheet && !isReduced()) setPhase("opening");
      else setPhase("open");
    }
    if (!open && was) {
      if (restoreFocus && opener.current && opener.current.isConnected) opener.current.focus();
      if (asSheet && !isReduced()) setPhase("closing");
      else setPhase("closed");
    }
  }, [open, asSheet, restoreFocus]);

  useEffect(() => {
    if (phase === "opening" || phase === "closing") {
      const next: Phase = phase === "opening" ? "open" : "closed";
      const timer = window.setTimeout(() => setPhase(next), MOTION_MS.sheet);
      const forward = phase === "opening";
      surface.current?.animate(
        { transform: forward ? ["translateY(100%)", "translateY(0)"] : ["translateY(0)", "translateY(100%)"] },
        { duration: MOTION_MS.sheet, easing: "cubic-bezier(.2,.8,.2,1)", fill: "both" },
      );
      body.current?.animate(
        { opacity: forward ? [0, 1] : [1, 0] },
        { duration: MOTION_MS.sheet, easing: "cubic-bezier(.2,.8,.2,1)", fill: "both" },
      );
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [phase]);

  const visible = phase !== "closed";

  useLayoutEffect(() => {
    if (open && visible && root.current && !root.current.contains(document.activeElement)) {
      const target = initialFocus?.(root.current) ?? focusables(root.current)[0] ?? root.current;
      target.focus();
    }
  }, [open, visible]);

  useEffect(() => {
    if (!open) return undefined;
    const pull = (event: FocusEvent): void => {
      const node = root.current;
      if (node && wasOpen.current && event.target instanceof Node && !node.contains(event.target)) {
        (focusables(node)[0] ?? node).focus();
      }
    };
    document.addEventListener("focusin", pull);
    return () => document.removeEventListener("focusin", pull);
  }, [open]);

  if (!visible) return null;

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape" && !event.defaultPrevented) {
      event.preventDefault();
      event.stopPropagation();
      closeRef.current();
      return;
    }
    if (event.key !== "Tab" || !root.current) return;
    const list = focusables(root.current);
    const first = list[0];
    const last = list[list.length - 1];
    if (!first || !last) {
      event.preventDefault();
      return;
    }
    const active = document.activeElement;
    if (!root.current.contains(active)) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && (active === first || active === root.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const motionAttrs = asSheet
    ? {
        "data-motion": "sheet",
        "data-motion-ms": String(isReduced() ? 0 : MOTION_MS.sheet),
        "data-state": phase,
      }
    : {};

  return createPortal(
    <div className={`dialog-layer${asSheet ? " is-sheet" : ""}`}>
      <div className="dialog-backdrop" onClick={() => open && closeRef.current()} aria-hidden="true" />
      <div
        ref={root}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`dialog${className ? ` ${className}` : ""}`}
        onKeyDown={onKeyDown}
        onTouchStart={(event) => {
          const touch = event.touches[0];
          if (asSheet && touch) swipe.current = { start: touch.clientY, last: touch.clientY };
        }}
        onTouchMove={(event) => {
          const touch = event.touches[0];
          if (swipe.current && touch) swipe.current.last = touch.clientY;
        }}
        onTouchEnd={() => {
          const gesture = swipe.current;
          swipe.current = null;
          if (gesture && gesture.last - gesture.start >= 80) closeRef.current();
        }}
        {...motionAttrs}
      >
        <div className="dialog-surface" ref={surface} aria-hidden="true" />
        <div className="dialog-body" ref={body}>
          <h2 id={titleId} className="dialog-title">
            {title}
          </h2>
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
