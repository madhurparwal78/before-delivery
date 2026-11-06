// Modal dialogs (focus handling adapted from kit/modules/a11y_dialog). Dialogs stack: only the top
// one takes Tab, Shift+Tab and Escape, and a backdrop under it blocks the pointer. Lower dialogs stay
// mounted with every value. Focus goes to the first field (or `initialFocus`) on open and back to the
// opener on close, or to `fallbackFocus` when the opener no longer exists.
import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const stack: HTMLElement[] = [];

function top(): HTMLElement | undefined {
  return stack[stack.length - 1];
}

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.tabIndex >= 0 && el.getClientRects().length > 0);
}

function onKeyDown(event: KeyboardEvent): void {
  const dialog = top();
  if (!dialog) return;
  if (event.key === "Escape") {
    event.preventDefault();
    dialog.dispatchEvent(new CustomEvent("dialog-escape"));
    return;
  }
  if (event.key !== "Tab") return;
  const items = focusables(dialog);
  if (items.length === 0) {
    event.preventDefault();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !dialog.contains(active))) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
    event.preventDefault();
    first?.focus();
  }
}

function onFocusIn(event: FocusEvent): void {
  const dialog = top();
  if (!dialog || !(event.target instanceof Node) || dialog.contains(event.target)) return;
  (focusables(dialog)[0] ?? dialog).focus();
}

document.addEventListener("keydown", onKeyDown, true);
document.addEventListener("focusin", onFocusIn, true);

interface DialogProps {
  title: string;
  role?: "dialog" | "alertdialog";
  onClose: () => void;
  /** Sign in again cannot be dismissed. */
  dismissible?: boolean;
  initialFocus?: RefObject<HTMLElement>;
  /** Where focus goes on close when the opener is gone (the pane or screen heading). */
  fallbackFocus?: () => HTMLElement | null;
  /** Overrides the opener on close (revoke lands on the row's Restore access button). */
  returnFocus?: () => HTMLElement | null;
  describedBy?: string;
  wide?: boolean;
  children: ReactNode;
}

export function Dialog(props: DialogProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return undefined;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    stack.push(dialog);
    const target = latest.current.initialFocus?.current ?? focusables(dialog)[0] ?? dialog;
    target.focus();
    const escape = (): void => {
      if (latest.current.dismissible !== false && top() === dialog) latest.current.onClose();
    };
    dialog.addEventListener("dialog-escape", escape);
    return () => {
      dialog.removeEventListener("dialog-escape", escape);
      stack.splice(stack.indexOf(dialog), 1);
      const preferred = latest.current.returnFocus?.() ?? null;
      const back =
        preferred ??
        (opener && opener.isConnected && opener.getClientRects().length > 0 ? opener : null) ??
        latest.current.fallbackFocus?.() ??
        null;
      back?.focus({ preventScroll: true });
    };
  }, []);

  return createPortal(
    <div className="dialog-layer">
      <div className="dialog-backdrop" onMouseDown={(event) => event.preventDefault()} />
      <div
        ref={ref}
        className={props.wide ? "dialog dialog-wide" : "dialog"}
        role={props.role ?? "dialog"}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={props.describedBy}
        tabIndex={-1}
      >
        <h2 id={titleId} className="dialog-title">
          {props.title}
        </h2>
        {props.children}
      </div>
    </div>,
    document.body,
  );
}
