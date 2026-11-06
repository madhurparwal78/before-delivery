/** Shared client pieces: the focus-trapping dialog, money formatting and
 *  small UI helpers. */

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

export function useFocusTrap(open: boolean, onClose: () => void): { ref: (node: HTMLElement | null) => void } {
  const nodeRef = useRef<HTMLElement | null>(null);
  const openerRef = useRef<Element | null>(null);
  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement;
    const node = nodeRef.current;
    const first = node?.querySelector<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])") ?? null;
    first?.focus();
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab" || node === null) return;
      const focusables = Array.from(node.querySelectorAll<HTMLElement>("button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"));
      if (focusables.length === 0) return;
      const firstEl = focusables[0]!;
      const lastEl = focusables[focusables.length - 1]!;
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      } else if (!node.contains(document.activeElement)) {
        e.preventDefault();
        firstEl.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      (openerRef.current instanceof HTMLElement ? openerRef.current : null)?.focus();
    };
  }, [open, onClose]);
  return {
    ref: (node: HTMLElement | null) => {
      nodeRef.current = node;
    },
  };
}

export type DialogProps = {
  title: string;
  onClose: () => void;
  children: ReactNode;
};

export function Dialog({ title, onClose, children }: DialogProps): JSX.Element {
  const trap = useFocusTrap(true, onClose);
  return (
    <div className="dialog-backdrop">
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title} ref={trap.ref}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function BottomSheet({ title, onClose, children }: DialogProps): JSX.Element {
  const trap = useFocusTrap(true, onClose);
  return (
    <div className="dialog-backdrop" style={{ alignItems: "flex-end", padding: "0" }}>
      <div className="bottom-sheet" role="dialog" aria-modal="true" aria-label={title} ref={trap.ref}>
        <div className="sheet-handle" aria-hidden="true" />
        {children}
      </div>
    </div>
  );
}

/** Money with a thousands comma: $1,234.50, minus before the dollar sign. */
export function money(amount: string | null | undefined): string {
  if (amount === null || amount === undefined) return "$0.00";
  const negative = amount.startsWith("-");
  const digits = negative ? amount.slice(1) : amount;
  const [dollarPart, centPart = "00"] = digits.split(".");
  const cents = (centPart + "00").slice(0, 2);
  const withCommas = (dollarPart ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}$${withCommas}.${cents}`;
}

export function formatLocalMinute(value: string): string {
  return value.slice(0, 16).replace("T", " ");
}

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const goOnline = (): void => setOnline(true);
    const goOffline = (): void => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);
  return online;
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
