import { ReactNode, useEffect, useRef } from "react";

/**
 * Dialogs, drawers and menus (DP-82, DP-92): focus stays inside, Escape closes,
 * focus returns to the opener, and a closed layer is fully inert.
 */

interface DialogProps {
  label: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

export function Dialog({ label, open, onClose, children }: DialogProps): ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  const openerRef = useRef<Element | null>(null);
  useEffect(() => {
    if (open) {
      openerRef.current = document.activeElement;
      const first = ref.current?.querySelector<HTMLElement>(
        "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
      );
      first?.focus();
    } else if (openerRef.current instanceof HTMLElement) {
      openerRef.current.focus();
    }
  }, [open]);
  if (!open) return null;
  return (
    <div className="dialog-backdrop" onMouseDown={e => {
      if (e.target === e.currentTarget) onClose();
    }}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="dialog"
        onKeyDown={e => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onClose();
            return;
          }
          if (e.key === "Tab") {
            const focusables = Array.from(
              ref.current?.querySelectorAll<HTMLElement>(
                "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
              ) ?? [],
            );
            if (focusables.length === 0) return;
            const first = focusables[0];
            const last = focusables[focusables.length - 1];
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault();
              last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first.focus();
            }
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}

interface MenuProps {
  label: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

export function Menu({ label, open, onClose, children }: MenuProps): ReactNode {
  return open ? (
    <div className="menu-wrap">
      <div role="menu" aria-label={label} className="menu" onKeyDown={e => {
        if (e.key === "Escape") onClose();
      }}>
        {children}
      </div>
    </div>
  ) : null;
}
