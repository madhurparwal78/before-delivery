// Dialogs and bottom sheets: focus moves in on open, Tab and Shift+Tab wrap inside, Escape closes,
// and focus returns to the opener. Sheets slide and dialogs fade on the page clock (requestAnimationFrame).
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { reducedMotion } from "./api";

const ENTER_MS = 250;
const easeOut = (t: number): number => 1 - (1 - t) ** 3;

function tween(duration: number, frame: (p: number) => void, done: () => void): () => void {
  if (reducedMotion()) {
    frame(1);
    done();
    return () => undefined;
  }
  let start: number | null = null;
  let handle = 0;
  const step = (ts: number): void => {
    start ??= ts;
    const p = Math.min(1, (ts - start) / duration);
    frame(easeOut(p));
    if (p < 1) handle = requestAnimationFrame(step);
    else done();
  };
  handle = requestAnimationFrame(step);
  return () => cancelAnimationFrame(handle);
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((e) => e.getClientRects().length > 0 || e === document.activeElement);
}

interface Props {
  open: boolean;
  title: string;
  variant: "sheet" | "dialog";
  onClose: () => void;
  /** Where focus goes when the dialog closes; defaults to whatever had focus when it opened. */
  returnFocus?: RefObject<HTMLElement | SVGSVGElement | null>;
  initialFocus?: RefObject<HTMLElement | null>;
  children: ReactNode;
}

export function Dialog({ open, title, variant, onClose, returnFocus, initialFocus, children }: Props) {
  const [mounted, setMounted] = useState(open);
  const panel = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  const headingId = useId();

  if (open && !mounted) setMounted(true);

  useLayoutEffect(() => {
    const el = panel.current;
    const bg = scrim.current;
    if (!mounted || el === null || bg === null) return;
    const apply = (p: number): void => {
      bg.style.opacity = String(p);
      if (variant === "sheet") el.style.transform = `translateY(${(1 - p) * 100}%)`;
      else {
        el.style.opacity = String(p);
        el.style.transform = `translate(-50%, -50%) scale(${0.97 + 0.03 * p})`;
      }
    };
    if (open) {
      opener.current = document.activeElement;
      apply(0);
      const first = initialFocus?.current ?? focusables(el)[0] ?? el;
      first.focus({ preventScroll: true });
      return tween(ENTER_MS, apply, () => undefined);
    }
    const target = returnFocus?.current ?? opener.current;
    if (target instanceof HTMLElement || target instanceof SVGElement) target.focus({ preventScroll: true });
    return tween(ENTER_MS, (p) => apply(1 - p), () => setMounted(false));
    // The animation runs once per open/close change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mounted]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      const el = panel.current;
      if (el === null) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables(el);
      const first = items[0];
      const last = items[items.length - 1];
      if (first === undefined || last === undefined) {
        e.preventDefault();
        return;
      }
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !el.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !el.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  if (!mounted) return null;
  const closing = open ? "" : " closing";
  return (
    <>
      {/* A fresh press on the scrim closes; the click a touch gesture leaves behind does not. */}
      <div ref={scrim} className={`scrim${closing}`} onPointerDown={open ? onClose : undefined} aria-hidden="true" />
      <div ref={panel} className={`${variant === "sheet" ? "sheet" : "dialog"}${closing}`} role="dialog" aria-modal="true" aria-labelledby={headingId} tabIndex={-1}
        aria-hidden={open ? undefined : true} inert={!open}>
        <h2 id={headingId} className="dialog-title">{title}</h2>
        {children}
      </div>
    </>
  );
}
