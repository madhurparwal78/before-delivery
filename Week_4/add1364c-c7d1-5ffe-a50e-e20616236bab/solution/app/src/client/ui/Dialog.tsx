import { useEffect, useRef, type FormEvent, type ReactNode } from "react";

const FOCUSABLE = 'button:not([disabled]):not([aria-disabled="true"]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
}

interface Props {
  label: string;
  onClose: () => void;
  children: ReactNode;
  /** element to receive focus when the dialog closes; defaults to the element focused when it opened */
  returnFocus?: () => HTMLElement | null;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  formRef?: React.RefObject<HTMLFormElement | null>;
  className?: string;
}

/** A native modal dialog that traps focus, closes on Escape and hands focus back. */
export function Dialog({ label, onClose, children, returnFocus, onSubmit, formRef, className }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(document.activeElement);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const returnRef = useRef(returnFocus);
  returnRef.current = returnFocus;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    const first = dialog.querySelector<HTMLElement>("[data-autofocus]") ?? focusables(dialog)[0] ?? dialog;
    first.focus();
    const onCancel = (event: Event) => { event.preventDefault(); closeRef.current(); };
    dialog.addEventListener("cancel", onCancel);
    const from = opener.current;
    return () => {
      dialog.removeEventListener("cancel", onCancel);
      if (dialog.open) dialog.close();
      const target = returnRef.current?.() ?? (from instanceof HTMLElement ? from : null);
      if (target && document.contains(target)) target.focus();
    };
  }, []);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== "Tab") return;
    const dialog = ref.current;
    if (!dialog) return;
    const items = focusables(dialog);
    if (items.length === 0) { event.preventDefault(); return; }
    const first = items[0] as HTMLElement;
    const last = items[items.length - 1] as HTMLElement;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !dialog.contains(active))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (active === last || !dialog.contains(active))) { event.preventDefault(); first.focus(); }
  };

  const body = onSubmit
    ? <form ref={formRef} noValidate onSubmit={onSubmit} className="dialog-form">{children}</form>
    : <div className="dialog-form">{children}</div>;

  return (
    <dialog ref={ref} aria-label={label} className={`dialog ${className ?? ""}`} onKeyDown={onKeyDown}>
      <h2 className="dialog-title">{label}</h2>
      {body}
    </dialog>
  );
}
