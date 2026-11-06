// Shared interface pieces: modal dialogs and the focus trap for drawers and sheets (adapted from
// kit/modules/a11y_dialog), plus small status helpers.
import { useEffect, useId, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { TriangleAlert, X } from "lucide-react";

const FOCUSABLE = "button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])";

export function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((e) => e.offsetParent !== null || e === document.activeElement);
}

/** Keeps Tab inside `root`: the last element wraps to the first and back. */
function trapTab(event: KeyboardEvent | React.KeyboardEvent, root: HTMLElement): void {
  if (event.key !== "Tab") return;
  const items = focusables(root);
  if (items.length === 0) {
    event.preventDefault();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !root.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !root.contains(active))) {
    event.preventDefault();
    first.focus();
  }
}

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  initialFocus?: RefObject<HTMLElement | null>;
  className?: string;
}

/** A native modal <dialog>: focus moves in, Tab stays in, Escape closes, focus returns to the opener. */
export function Modal({ title, onClose, children, initialFocus, className }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useLayoutEffect(() => {
    const dialog = ref.current as HTMLDialogElement;
    const opener = document.activeElement as HTMLElement | null;
    dialog.showModal();
    (initialFocus?.current ?? focusables(dialog)[0])?.focus();
    return () => {
      dialog.close();
      opener?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${className ?? ""}`}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => trapTab(event, ref.current as HTMLDialogElement)}
    >
      <h2 id={titleId} className="modal-title">{title}</h2>
      {children}
      <button type="button" className="icon-button modal-close" aria-label="Close" onClick={onClose}>
        <X aria-hidden size={18} strokeWidth={1.5} />
      </button>
    </dialog>
  );
}

/** Focus trap and Escape for a drawer or bottom sheet while it is open. */
export function useTrap(ref: RefObject<HTMLElement | null>, active: boolean, onEscape: () => void): void {
  const escape = useRef(onEscape);
  escape.current = onEscape;
  useEffect(() => {
    const root = ref.current;
    if (!active || !root) return;
    const opener = document.activeElement as HTMLElement | null;
    focusables(root)[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (document.querySelector("dialog[open]")) return;
      if (event.key === "Escape") {
        event.preventDefault();
        escape.current();
      }
      trapTab(event, root);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (root.contains(document.activeElement) || document.activeElement === document.body) opener?.focus();
    };
  }, [active]);
}

export function ErrorLine({ children }: { children: ReactNode }) {
  return (
    <p className="error-line" role="alert">
      <TriangleAlert aria-hidden size={16} strokeWidth={1.5} />
      <span>{children}</span>
    </p>
  );
}

export function CairnMark({ size = 20 }: { size?: number }) {
  return (
    <svg className="cairn-mark" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <ellipse cx="12" cy="20" rx="8" ry="2.6" />
      <ellipse cx="12" cy="14.6" rx="6" ry="2.3" />
      <ellipse cx="12" cy="9.8" rx="4.2" ry="1.9" />
      <ellipse cx="12" cy="5.8" rx="2.6" ry="1.5" />
    </svg>
  );
}
