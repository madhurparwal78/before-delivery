import { useCallback, useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

// Modal dialog (adapted from kit a11y_dialog): the page behind is inert, Tab cycles inside, Escape closes,
// focus returns to the opener. It fades in and out unless the user asked for reduced motion.

const FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

export type CloseDialog = (options?: { returnFocus?: boolean }) => void;

export const prefersReducedMotion = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function setShellInert(inert: boolean): void {
  document.querySelectorAll<HTMLElement>("[data-shell]").forEach((el) => {
    el.inert = inert;
  });
}

interface DialogProps {
  title: string;
  onClosed: () => void;
  children: (close: CloseDialog) => ReactNode;
}

export function Dialog({ title, onClosed, children }: DialogProps) {
  const titleId = useId();
  const scrimRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const closing = useRef(false);

  const close = useCallback<CloseDialog>(
    (options = {}) => {
      if (closing.current) return;
      closing.current = true;
      setShellInert(false);
      if (options.returnFocus !== false) opener.current?.focus();
      const scrim = scrimRef.current;
      if (!scrim || prefersReducedMotion()) {
        onClosed();
        return;
      }
      // The page is live again while the scrim fades out, so the scrim stops taking pointer input.
      scrim.style.pointerEvents = "none";
      scrim.animate([{ opacity: 1 },{ opacity: 0 }], { duration: 200, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "forwards" }).finished.then(onClosed, onClosed);
    },
    [onClosed],
  );

  useEffect(() => {
    setShellInert(true);
    const panel = panelRef.current;
    const field = panel?.querySelector<HTMLElement>("input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled])");
    const primary = panel?.querySelector<HTMLElement>("[data-primary]:not([disabled])");
    (field ?? primary ?? panel)?.focus();
    return () => setShellInert(false);
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab" || !panelRef.current) return;
    const items = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) {
      event.preventDefault();
      return;
    }
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === panelRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div className="scrim" ref={scrimRef}>
      <div ref={panelRef} className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={onKeyDown}>
        <h2 id={titleId}>{title}</h2>
        {children(close)}
      </div>
    </div>,
    document.body,
  );
}
