import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

export interface DialogProps {
  title: string;
  onClose: () => void;
  onSubmit?: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

/**
 * A modal dialog. Focus moves to the first control on open, wraps inside,
 * Escape closes without saving and focus returns to whatever opened it.
 */
export function Dialog({ title, onClose, onSubmit, children, footer }: DialogProps): ReactNode {
  const panel = useRef<HTMLDivElement | null>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    opener.current = document.activeElement as HTMLElement | null;
    const first = panel.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    return () => {
      opener.current?.focus();
    };
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key === "Enter" && onSubmit) {
      const target = event.target as HTMLElement;
      const isSingleLine = target.tagName === "INPUT";
      if (isSingleLine) {
        event.preventDefault();
        onSubmit();
        return;
      }
    }
    if (event.key !== "Tab") return;
    const nodes = [...(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter(
      (node) => node.offsetParent !== null || node === document.activeElement,
    );
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    }
  };

  return (
    <div className="scrim">
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={panel}
        onKeyDown={onKeyDown}
      >
        <h2 className="dialog__title">{title}</h2>
        <div className="dialog__body">{children}</div>
        {footer ? <div className="dialog__footer">{footer}</div> : null}
      </div>
    </div>
  );
}
