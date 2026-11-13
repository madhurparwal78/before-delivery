import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { EASE, MOTION, reducedNow, tween, useReducedMotion } from "../lib/motion";

// Every dialog traps Tab, closes on Escape and returns focus to its opener.
// Drawers and sheets slide (WAAPI) and publish data-state/data-motion-ms; the state flips on
// page-clock timers so it can be stepped. Modals appear and disappear at once.

type DialogKind = "drawer" | "sheet" | "menu" | "modal" | "alert";
type Phase = "closed" | "opening" | "open" | "closing";

interface Props {
  title: string;
  kind: DialogKind;
  open: boolean;
  onClose: () => void;
  /** Hides the visible title (the accessible name stays). */
  hideTitle?: boolean;
  /** Element to refocus on close; defaults to the element focused when the dialog opened. */
  openerRef?: RefObject<HTMLElement | null>;
  className?: string;
  children: ReactNode;
}

const FOCUSABLE = 'button, input:not([type="hidden"]), select, textarea, a[href], summary, [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => !el.hasAttribute("disabled") && !el.closest("[hidden],[inert]") && el.getClientRects().length > 0,
  );
}

const slides: Record<DialogKind, Keyframe | null> = {
  drawer: { transform: "translateX(100%)" },
  menu: { transform: "translateX(-100%)" },
  sheet: { transform: "translateY(100%)" },
  modal: null,
  alert: null,
};

/**
 * Slides between the resting place and an edge. The slide plays in real time (WAAPI); the same slide is also stepped on
 * the page clock, and when the page clock completes it the slide ends at once, so stepping the clock never leaves a
 * half-way sheet under a pointer.
 */
function slideIn(el: HTMLElement | null, edge: string, entering: boolean): void {
  if (!el) return;
  const axis = edge.includes("X") ? "X" : "Y";
  const sign = edge.includes("-") ? -1 : 1;
  const at = (progress: number): string => (progress === 0 ? "none" : `translate${axis}(${sign * progress * 100}%)`);
  el.getAnimations().forEach((a) => a.cancel());
  el.animate([{ transform: at(entering ? 1 : 0) }, { transform: at(entering ? 0 : 1) }], { duration: MOTION.drawer, easing: EASE });
  tween(el, MOTION.drawer, (t) => {
    if (t < 1) return;
    el.getAnimations().forEach((a) => a.cancel());
    el.style.transform = "";
  });
}

function animated(kind: DialogKind): boolean {
  return kind === "drawer" || kind === "sheet" || kind === "menu";
}

export function Dialog({ title, kind, open, onClose, hideTitle, openerRef, className, children }: Props) {
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState<Phase>("closed");
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const opener = useRef<HTMLElement | null>(null);
  const head = useRef<HTMLDivElement>(null);
  const motionMs = animated(kind) && !reduced ? MOTION.drawer : 0;

  const phaseRef = useRef<Phase>("closed");
  const openNow = useRef(open);
  openNow.current = open;
  const go = (next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  };

  useLayoutEffect(() => {
    window.clearTimeout(timer.current);
    const phone = kind === "drawer" && window.matchMedia("(max-width: 639.98px)").matches;
    const slide = phone ? { transform: "translateY(100%)" } : (slides[kind] ?? {});
    if (open) {
      opener.current = (document.activeElement as HTMLElement | null) ?? null;
      if (!animated(kind) || reducedNow()) {
        go("open");
      } else {
        go("opening");
        timer.current = window.setTimeout(() => go("open"), MOTION.drawer);
        slideIn(ref.current, String(slide.transform), true);
      }
    } else if (phaseRef.current !== "closed") {
      if (!animated(kind) || reducedNow()) {
        go("closed");
      } else {
        go("closing");
        timer.current = window.setTimeout(() => go("closed"), MOTION.drawer);
        slideIn(ref.current, String(slide.transform), false);
      }
      const target = openerRef?.current ?? opener.current;
      if (target && document.contains(target)) target.focus();
    }
    return () => window.clearTimeout(timer.current);
  }, [open, kind, openerRef]);

  useEffect(() => {
    if (!open || phase === "closed" || !ref.current) return;
    const root = ref.current;
    if (!root.contains(document.activeElement)) {
      const first = root.querySelector<HTMLElement>("[data-autofocus]") ?? focusables(root)[0] ?? root;
      first.focus();
    }
  }, [open, phase]);

  useEffect(() => {
    if (!open) return;
    const pull = (event: FocusEvent) => {
      const root = ref.current;
      if (openNow.current && root && event.target instanceof Node && !root.contains(event.target)) {
        (focusables(root)[0] ?? root).focus();
      }
    };
    document.addEventListener("focusin", pull);
    return () => document.removeEventListener("focusin", pull);
  }, [open]);

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !ref.current) return;
      const items = focusables(ref.current);
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) {
        event.preventDefault();
        return;
      }
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !ref.current.contains(active) || active === ref.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  // A document-level Escape also closes, for the moment before focus has moved in.
  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (openNow.current && event.key === "Escape" && !ref.current?.contains(document.activeElement)) onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // A downward swipe on a sheet's head closes it. Touch events (not pointer events) so the move can cancel the scroll.
  useEffect(() => {
    const el = head.current;
    if (!el || kind !== "sheet" || !open) return;
    let from: number | null = null;
    const start = (event: TouchEvent) => {
      from = event.touches[0]?.clientY ?? null;
    };
    const move = (event: TouchEvent) => {
      const y = event.touches[0]?.clientY;
      if (from === null || y === undefined) return;
      if (event.cancelable) event.preventDefault();
      if (y - from > 60) {
        from = null;
        onClose();
      }
    };
    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    return () => {
      el.removeEventListener("touchstart", start);
      el.removeEventListener("touchmove", move);
    };
  });

  const visible = phase !== "closed";
  const role = kind === "alert" ? "alertdialog" : "dialog";
  const titleId = `dialog-title-${title.replace(/\W+/g, "-").toLowerCase()}`;

  if (!animated(kind) && !visible) return null;

  return createPortal(
    <>
      {(phase === "open" || phase === "opening") && <div className="scrim" data-kind={kind} onClick={onClose} aria-hidden="true" />}
      <div
        ref={ref}
        role={role}
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`dialog dialog-${kind} ${className ?? ""}`}
        data-state={phase}
        data-motion-ms={motionMs}
        inert={!visible || phase === "closing" ? true : undefined}
        onKeyDown={onKeyDown}
      >
        {visible && (
          <>
            <div
              ref={head}
              className="dialog-head"
            >
              {kind === "sheet" && <span className="grabber" aria-hidden="true" />}
              <h2 id={titleId} className={hideTitle ? "sr-only" : "dialog-title"}>
                {title}
              </h2>
            </div>
            <div className="dialog-body">{children}</div>
          </>
        )}
      </div>
    </>,
    document.body,
  );
}
