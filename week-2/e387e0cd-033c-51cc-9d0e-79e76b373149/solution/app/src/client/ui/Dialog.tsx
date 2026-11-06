// Dialogs and sheets (adapted from kit/modules/a11y_dialog): focus moves in, Tab wraps, Escape closes, focus
// returns to the opener, a closing panel is inert at once, and reopening during the exit keeps it open.
import type { ComponentChildren } from "preact";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "preact/hooks";
import { EASE, reducedMotion, STATE_MS, WIDE_QUERY } from "../hooks";
import { Icon } from "./Icon";

type DialogKind = "modal" | "sheet" | "side";

interface DialogProps {
  open: boolean;
  label: string;
  onClose: () => void;
  kind?: DialogKind;
  /** Put a Close button first (station sheets and the facts sheet). */
  closeFirst?: boolean;
  /** Return focus to the opener when it closes (not when it closes because the screen changed). */
  restoreFocus?: boolean;
  wide?: boolean;
  children: ComponentChildren;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0 || el.matches('input[type="file"]'));
}

function frames(kind: DialogKind): Keyframe[] {
  const fromSide = kind === "side" && matchMedia(WIDE_QUERY).matches;
  if (fromSide) return [{ transform: "translateX(100%)" }, { transform: "translateX(0)" }];
  if (kind === "modal") return [{ opacity: 0, transform: "translateY(8px) scale(0.98)" }, { opacity: 1, transform: "none" }];
  return [{ transform: "translateY(100%)" }, { transform: "translateY(0)" }];
}

type Phase = "closed" | "open" | "closing";

export function Dialog({ open, label, onClose, kind = "modal", closeFirst = false, restoreFocus = true, wide = false, children }: DialogProps) {
  const [phase, setPhase] = useState<Phase>(open ? "open" : "closed");
  const panel = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const exit = useRef<Animation[]>([]);
  const entered = useRef(false);
  const reopening = useRef(false);
  const restore = useRef(restoreFocus);
  restore.current = restoreFocus;
  const headingId = useId();

  useLayoutEffect(() => {
    if (open && phase === "closed") {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      entered.current = false;
      setPhase("open");
    } else if (open && phase === "closing") {
      for (const a of exit.current) a.cancel();
      exit.current = [];
      entered.current = false;
      reopening.current = true;
      setPhase("open");
    } else if (!open && phase === "open") {
      setPhase("closing");
    }
  }, [open]);

  useLayoutEffect(() => {
    const el = panel.current;
    if (phase === "open" && el && !entered.current) {
      const reopened = reopening.current;
      reopening.current = false;
      entered.current = true;
      const first = focusables(el)[0] ?? el;
      first.focus();
      if (!reducedMotion() && !reopened) {
        el.animate(frames(kind), { duration: STATE_MS, easing: EASE });
        backdrop.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: STATE_MS, easing: EASE });
      }
    }
    if (phase === "closing" && el) {
      if (restore.current && opener.current?.isConnected) opener.current.focus();
      if (reducedMotion()) {
        setPhase("closed");
        return;
      }
      const options: KeyframeAnimationOptions = { duration: STATE_MS, easing: EASE, fill: "forwards" };
      exit.current = [el.animate([...frames(kind)].reverse(), options)];
      if (backdrop.current) exit.current.push(backdrop.current.animate([{ opacity: 1 }, { opacity: 0 }], options));
      const mine = exit.current;
      Promise.all(mine.map((a) => a.finished)).then(() => {
        if (exit.current === mine) setPhase("closed");
      }, () => undefined);
    }
  }, [phase]);

  useEffect(() => {
    if (phase === "closed") entered.current = false;
  }, [phase]);

  if (phase === "closed") return null;

  const onKeyDown = (event: KeyboardEvent) => {
    const el = panel.current;
    if (!el) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const list = focusables(el);
    if (list.length === 0) {
      event.preventDefault();
      return;
    }
    const active = document.activeElement;
    const first = list[0];
    const last = list[list.length - 1];
    if (event.shiftKey && (active === first || active === el || !el.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !el.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  };

  const closing = phase === "closing";
  return (
    <div class={`dialog-layer dialog-${kind}${wide ? " dialog-wide" : ""}`}>
      <div ref={backdrop} class="dialog-backdrop" onClick={closing ? undefined : onClose} aria-hidden="true" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        class="dialog-panel"
        tabIndex={-1}
        inert={closing}
        onKeyDown={onKeyDown}
      >
        <div class="dialog-head">
          <h2 id={headingId} class="dialog-title">{label}</h2>
          {closeFirst && (
            <button type="button" class="button button-quiet button-icon-text" onClick={onClose}>
              <Icon name="close" />
              <span>Close</span>
            </button>
          )}
        </div>
        <div class="dialog-body">{children}</div>
      </div>
    </div>
  );
}
