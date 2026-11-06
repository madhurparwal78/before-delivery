// A modal <dialog> (adapted from kit/modules/a11y_dialog): focus moves to its first control, Tab
// and Shift+Tab wrap inside it, Escape closes it, and focus returns to where it was before.
import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { useExit } from "./exit";

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest("[hidden]"));
}

/** Keeps Tab and Shift+Tab inside `root`. */
function trapTab(event: React.KeyboardEvent, root: HTMLElement | null): void {
  if (event.key !== "Tab" || !root) return;
  const items = focusables(root);
  if (items.length === 0) {
    event.preventDefault();
    return;
  }
  const first = items[0] as HTMLElement;
  const last = items[items.length - 1] as HTMLElement;
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !root.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !root.contains(active))) {
    event.preventDefault();
    first.focus();
  }
}

export function Dialog(props: {
  label: string;
  onClose: () => void;
  children: ReactNode;
  /** Changes when the dialog shows new content; focus then moves to its first control again. */
  contentKey?: string;
  returnFocus?: HTMLElement | null;
}): JSX.Element {
  const ref = useExit<HTMLDialogElement>("pop");
  const opener = useRef<HTMLElement | null>(props.returnFocus ?? (document.activeElement as HTMLElement | null));
  const onClose = useRef(props.onClose);
  onClose.current = props.onClose;

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    const first = focusables(dialog)[0];
    first?.focus();
  }, [props.contentKey]);

  useEffect(() => {
    const restore = opener.current;
    return () => {
      if (restore && restore.isConnected) restore.focus();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-label={props.label}
      onCancel={(event) => {
        event.preventDefault();
        onClose.current();
      }}
      onClose={() => onClose.current()}
      onKeyDown={(event) => trapTab(event, ref.current)}
    >
      {props.children}
    </dialog>
  );
}
