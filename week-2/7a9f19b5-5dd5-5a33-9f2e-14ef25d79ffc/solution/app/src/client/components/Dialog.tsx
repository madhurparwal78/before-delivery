// Modal dialogs (adapted from kit/modules/a11y_dialog): focus moves to the first control, Tab and Shift+Tab wrap,
// Escape closes, closing returns focus to the opener, and the page behind is inert while it is open.
import { X } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePresence } from "../lib/presence";

function tabbable(root: HTMLElement): HTMLElement[] {
  const candidates = root.querySelectorAll<HTMLElement>(
    "a[href], button, input, select, textarea, [tabindex]:not([tabindex='-1'])",
  );
  return [...candidates].filter((element) => {
    if (element.matches(":disabled") || element.closest("[inert]") || element.getClientRects().length === 0) return false;
    if (element instanceof HTMLInputElement && element.type === "radio" && !element.checked) {
      const group = root.querySelectorAll<HTMLInputElement>(`input[type=radio][name="${element.name}"]`);
      return ![...group].some((radio) => radio.checked);
    }
    return true;
  });
}

interface DialogProps {
  title: string;
  open: boolean;
  onClose: () => void;
  variant?: "modal" | "sheet" | "menu";
  children: ReactNode;
}

export function Dialog({ title, open, onClose, variant = "modal", children }: DialogProps) {
  const headingId = useId();
  const opener = useRef<HTMLElement | null>(null);
  const { ref, mounted, closing } = usePresence<HTMLDivElement>(open);

  useLayoutEffect(() => {
    if (!open || !mounted) return;
    opener.current ??= document.activeElement as HTMLElement | null;
    const root = document.getElementById("root");
    if (root) root.inert = true;
    const first = ref.current ? tabbable(ref.current)[0] : undefined;
    (first ?? ref.current)?.focus();
    // Focus is placed once per opening.
  }, [open, mounted]);

  useEffect(() => {
    if (open) return;
    const root = document.getElementById("root");
    if (root) root.inert = false;
    const target = opener.current;
    opener.current = null;
    if (target?.isConnected) target.focus();
  }, [open]);

  if (!mounted) return null;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !ref.current) return;
    const items = tabbable(ref.current);
    if (!items.length) {
      event.preventDefault();
      return;
    }
    const edge = event.shiftKey ? items[0] : items[items.length - 1];
    if (document.activeElement === edge || !ref.current.contains(document.activeElement)) {
      event.preventDefault();
      (event.shiftKey ? items[items.length - 1] : items[0])!.focus();
    }
  };

  return createPortal(
    <div className={`dialog-layer dialog-layer--${variant}${closing ? " is-closing" : ""}`}>
      <div className="dialog-scrim" onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className={`dialog dialog--${variant}`}
        onKeyDown={onKeyDown}
        tabIndex={-1}
        inert={closing}
        aria-hidden={closing || undefined}
      >
        <h2 id={headingId} className="dialog__title">
          {title}
        </h2>
        <div className="dialog__body">{children}</div>
        <button type="button" className="dialog__close icon-button" aria-label="Close" onClick={onClose}>
          <X aria-hidden="true" size={20} strokeWidth={1.5} />
        </button>
      </div>
    </div>,
    document.body,
  );
}
