import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

// The kit's a11y_dialog contract as a React component: focus moves inside on open, Tab and
// Shift+Tab wrap, Escape closes, and focus returns to the opener (or to `returnFocus`).

const FOCUSABLE = "button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])";

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest("[inert]") && el.offsetParent !== null);
}

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

interface DialogProps {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  initialFocus?: RefObject<HTMLElement | null>;
  returnFocus?: RefObject<HTMLElement | null>;
  variant?: "center" | "sheet";
  hideTitle?: boolean;
}

export function Dialog({ title, open, onClose, children, initialFocus, returnFocus, variant = "center", hideTitle = false }: DialogProps) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (open) {
      opener.current = document.activeElement as HTMLElement | null;
      setMounted(true);
      setClosing(false);
      return;
    }
    if (!mounted) return;
    (returnFocus?.current ?? opener.current)?.focus();
    if (reducedMotion()) setMounted(false);
    else setClosing(true);
  }, [open]);

  // Reopened during its closing animation, the panel is still inert until `closing` clears.
  useEffect(() => {
    if (!open || !mounted || closing || !panel.current) return;
    const target = initialFocus?.current ?? focusables(panel.current)[0] ?? panel.current;
    target.focus();
  }, [open, mounted, closing]);

  if (!mounted) return null;

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !panel.current) return;
    const items = focusables(panel.current);
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const first = items[0] as HTMLElement;
    const last = items[items.length - 1] as HTMLElement;
    if (event.shiftKey && (document.activeElement === first || !panel.current.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div className={`dialog-layer dialog-${variant}`} data-state={closing ? "closing" : "open"} inert={closing || undefined}>
      <div className="dialog-backdrop" onClick={onClose} />
      <div
        ref={panel}
        className="dialog-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onAnimationEnd={(animationEvent) => {
          if (closing && animationEvent.target === animationEvent.currentTarget) {
            setMounted(false);
            setClosing(false);
          }
        }}
      >
        <h2 id={id} className={hideTitle ? "visually-hidden" : "dialog-title"}>
          {title}
        </h2>
        {children}
      </div>
    </div>,
    document.body,
  );
}
