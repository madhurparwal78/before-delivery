import { useEffect, useState, useRef } from "react";
import { store } from "./store.ts";

/** The client-side path router: the address bar is the single source of truth. */
export function usePath(): [string, (next: string, replace?: boolean) => void] {
  const [path, setPath] = useState(() => window.location.pathname + window.location.search);
  useEffect(() => {
    const onPop = (): void => setPath(window.location.pathname + window.location.search);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const navigate = (next: string, replace = false): void => {
    if (!next.startsWith("/welcome")) store.justJoined = false;
    if (replace) {
      window.history.replaceState({}, "", next);
    } else {
      window.history.pushState({}, "", next);
    }
    setPath(next);
  };
  return [path, navigate];
}

/** A polite status region that announces once and clears. */
export function useAnnouncer(): { text: string; announce: (t: string) => void } {
  const [text, setText] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const announce = (t: string): void => {
    setText("");
    window.setTimeout(() => {
      setText(t);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setText(""), 8000);
    }, 30);
  };
  return { text, announce };
}

export interface DialogHandle {
  open: boolean;
}

/** Focus trap and Escape for dialogs and pickers. */
export function useDialog(open: boolean, onClose: () => void, openerRef: React.RefObject<HTMLElement | null>): void {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const node = dialogRef.current;
    const first = node?.querySelector<HTMLElement>(
      "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"
    );
    first?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const focusables = node?.querySelectorAll<HTMLElement>(
        "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"
      );
      if (!focusables || focusables.length === 0) return;
      const list = [...focusables].filter((el) => el.offsetParent !== null || el === document.activeElement);
      const firstEl = list[0];
      const lastEl = list[list.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      if (openerRef.current && openerRef.current.isConnected) openerRef.current.focus();
    };
  }, [open, onClose, openerRef]);
  void dialogRef;
}

export function useRefEffect(): React.RefObject<HTMLElement | null> {
  return useRef<HTMLElement | null>(null);
}
