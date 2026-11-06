import { useEffect, useId, useLayoutEffect, useRef, type FormEvent, type ReactNode } from "react";

// A modal dialog on <dialog>: centred from 768 px wide and a bottom sheet below. It traps focus (showModal),
// puts focus on its first field (or first button) the moment it opens, and Escape or Cancel closes it
// without saving and returns focus to the control that opened it.

interface DialogProps {
  title: string;
  open: boolean;
  /** Called for Escape and Cancel. */
  onCancel: () => void;
  /** The form submit (Enter in a field or the primary button). */
  onSubmit?: () => void;
  /** Footer buttons before Cancel; the first is the primary action. */
  actions: ReactNode;
  children?: ReactNode;
  /** A non-field refusal shown inside the dialog. */
  error?: string;
}

const FIRST_FIELD = "input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled])";
const FIRST_BUTTON = "button:not([disabled])";

export function Dialog({ title, open, onCancel, onSubmit, actions, children, error }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const cancel = useRef(onCancel);
  cancel.current = onCancel;

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
      const first = dialog.querySelector<HTMLElement>(FIRST_FIELD) ?? dialog.querySelector<HTMLElement>(FIRST_BUTTON);
      first?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
      if (opener.current?.isConnected) opener.current.focus();
    }
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const onNativeCancel = (event: Event): void => {
      event.preventDefault();
      cancel.current();
    };
    dialog.addEventListener("cancel", onNativeCancel);
    return () => dialog.removeEventListener("cancel", onNativeCancel);
  }, []);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    onSubmit?.();
  };

  return (
    <dialog ref={ref} className="dialog" aria-labelledby={titleId}>
      {open && (
        <form noValidate onSubmit={submit}>
          <div className="dialog-head">
            <h2 id={titleId}>{title}</h2>
          </div>
          <div className="dialog-body">
            {error && <p className="dialog-error">{error}</p>}
            {children}
          </div>
          <div className="dialog-foot">
            {actions}
            <button type="button" className="button" onClick={() => cancel.current()}>Cancel</button>
          </div>
        </form>
      )}
    </dialog>
  );
}

/** Moves focus to the first refused field's error text, else to the dialog's first button. */
export function focusRefusal(within: HTMLElement | null): void {
  if (!within) return;
  const target = within.querySelector<HTMLElement>(".field-error") ?? within.querySelector<HTMLElement>(FIRST_BUTTON);
  target?.focus();
}

/** The open dialog element, for focusing after a refusal. */
export const openDialog = (): HTMLDialogElement | null => document.querySelector<HTMLDialogElement>("dialog[open]");
