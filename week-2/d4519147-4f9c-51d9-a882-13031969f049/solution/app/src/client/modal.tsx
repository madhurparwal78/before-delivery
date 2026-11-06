import { useEffect, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Emitter } from "./emitter.ts";

/* The stack of open dialogs, sheets and drawers. Everything outside the top one is inert. */
const stack: symbol[] = [];
const stackChanges = new Emitter();

export function useModalDepth(): number {
  useSyncExternalStore(stackChanges.subscribe, stackChanges.snapshot);
  return stack.length;
}

const ENTER_MS = 240;

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest("[inert]") && el.getClientRects().length > 0);
}

interface ModalProps {
  kind: "dialog" | "alertdialog" | "drawer" | "sheet";
  label: string;
  /** Escape and the close control call this; omitted for Sign in to continue, which only closes on success. */
  onClose?: () => void;
  initialFocus?: RefObject<HTMLElement | null>;
  /** Where focus goes when the modal closes; defaults to the control that opened it. */
  returnFocus?: () => HTMLElement | null;
  className?: string;
  children: ReactNode;
}

export function Modal({ kind, label, onClose, initialFocus, returnFocus, className, children }: ModalProps) {
  const panel = useRef<HTMLDivElement>(null);
  const id = useRef(Symbol(label));
  const opener = useRef<Element | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const returnRef = useRef(returnFocus);
  returnRef.current = returnFocus;
  useModalDepth();
  // Before its first commit a modal is about to become the top one.
  const isTop = !stack.includes(id.current) || stack[stack.length - 1] === id.current;

  useLayoutEffect(() => {
    opener.current = document.activeElement;
    stack.push(id.current);
    stackChanges.emit();
    const target = initialFocus?.current ?? (panel.current ? focusables(panel.current)[0] : null) ?? panel.current;
    target?.focus();
    return () => {
      stack.splice(stack.indexOf(id.current), 1);
      stackChanges.emit();
      const back = returnRef.current?.() ?? (opener.current instanceof HTMLElement ? opener.current : null);
      const left = panel.current;
      // After the commit, once the page is no longer inert; unless something else already took focus.
      queueMicrotask(() => {
        const active = document.activeElement;
        if (back?.isConnected && (!active || active === document.body || !active.isConnected || left?.contains(active))) back.focus();
      });
    };
    // Mount-only: focus moves once when the modal opens and returns once when it closes.
  }, []);

  /* Entrance: dialogs fade, drawers slide from the right, sheets from the bottom, settling in about a quarter second. */
  useLayoutEffect(() => {
    const el = panel.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const start = performance.now();
    const paint = (t: number) => {
      const eased = 1 - (1 - t) ** 3;
      if (kind === "drawer") el.style.transform = t >= 1 ? "" : `translateX(${(1 - eased) * 100}%)`;
      else if (kind === "sheet") el.style.transform = t >= 1 ? "" : `translateY(${(1 - eased) * 100}%)`;
      else el.style.opacity = t >= 1 ? "" : String(eased);
    };
    let raf = 0;
    const tick = () => {
      const t = Math.min(1, (performance.now() - start) / ENTER_MS);
      paint(t);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    paint(0);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [kind]);

  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      if (stack[stack.length - 1] !== id.current || !panel.current) return;
      if (event.target instanceof Node && !panel.current.contains(event.target)) (focusables(panel.current)[0] ?? panel.current).focus();
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, []);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!panel.current || !isTop) return;
    if (event.key === "Escape") {
      event.stopPropagation();
      event.preventDefault();
      onCloseRef.current?.();
      return;
    }
    if (event.key !== "Tab") return;
    const items = focusables(panel.current);
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const first = items[0]!, last = items[items.length - 1]!;
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
    <div className={`modal-layer modal-${kind}`} inert={!isTop}>
      <div className="modal-scrim" aria-hidden="true" />
      <div
        ref={panel}
        role={kind === "alertdialog" ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={`modal-panel ${className ?? ""}`}
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
