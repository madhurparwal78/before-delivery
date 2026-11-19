import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { focusables } from "../lib/focus";
import { fadeElement } from "../lib/motion";

interface DialogProps {
  open: boolean;
  title: string;
  /** Called on Escape; the owner decides whether to set `open` false. */
  onClose: () => void;
  role?: "dialog" | "alertdialog";
  /** Where focus lands when the dialog closes; the opener when omitted. */
  returnFocus?: () => HTMLElement | null;
  className?: string;
  children: ReactNode;
}

const stack: symbol[] = [];

/** A modal dialog: focus moves in, Tab wraps, Escape closes, focus returns, and it fades at an even rate. */
export function Dialog({ open, title, onClose, role = "dialog", returnFocus, className, children }: DialogProps) {
  const [mounted, setMounted] = useState(open);
  const shell = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const id = useRef(Symbol("dialog"));
  const headingId = useId();
  const latest = useRef({ onClose, returnFocus });
  latest.current = { onClose, returnFocus };

  if (open && !mounted) setMounted(true);

  useLayoutEffect(() => {
    const element = shell.current;
    if (!open || !mounted || !element || !panel.current) return undefined;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const key = id.current;
    stack.push(key);
    const first = focusables(panel.current)[0];
    (first ?? panel.current).focus();
    const fadeIn = fadeElement(element, "in", Number.parseFloat(getComputedStyle(element).getPropertyValue("--dialog-ms")) || 166);

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && stack[stack.length - 1] === key) {
        event.preventDefault();
        event.stopPropagation();
        latest.current.onClose();
      }
    };
    const onFocusIn = (event: FocusEvent) => {
      if (stack[stack.length - 1] !== key || !panel.current || panel.current.contains(event.target as Node)) return;
      (focusables(panel.current)[0] ?? panel.current).focus();
    };
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      fadeIn?.cancel();
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("focusin", onFocusIn);
      const at = stack.indexOf(key);
      if (at >= 0) stack.splice(at, 1);
    };
  }, [open, mounted]);

  useEffect(() => {
    const element = shell.current;
    if (open || !mounted || !element) return undefined;
    // After the commit: React restores the focus it saw before the commit, so returning focus from the layout cleanup is overridden.
    const target = latest.current.returnFocus?.() ?? opener.current;
    if (target?.isConnected) target.focus();
    const fadeOut = fadeElement(element, "out", Number.parseFloat(getComputedStyle(element).getPropertyValue("--dialog-ms")) || 166);
    if (!fadeOut) { setMounted(false); return undefined; }
    element.style.pointerEvents = "none";
    let cancelled = false;
    void fadeOut.finished.then(() => { if (!cancelled) setMounted(false); }, () => undefined);
    return () => {
      cancelled = true;
      fadeOut.cancel();
      element.style.pointerEvents = "";
    };
  }, [open, mounted]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab" || !panel.current) return;
    const items = focusables(panel.current);
    if (items.length === 0) { event.preventDefault(); return; }
    const first = items[0] as HTMLElement;
    const last = items[items.length - 1] as HTMLElement;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === panel.current)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
  };

  if (!mounted) return null;
  return createPortal(
    <div className="dialog-backdrop" ref={shell}>
      <div
        className={`dialog${className ? ` ${className}` : ""}`}
        role={role}
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
        ref={panel}
        onKeyDown={onKeyDown}
      >
        <h2 id={headingId}>{title}</h2>
        {children}
      </div>
    </div>,
    document.body,
  );
}
