// A modal native <dialog>: focus stays inside, Escape closes it and focus returns to the opener.
// Adapted from kit/modules/a11y_dialog (open with showModal, close once, restore focus).
import { useId, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { call, type Result } from "./api";

export function Dialog({ title, onClose, onSubmit, children, actions }: {
  title: string; onClose: () => void; onSubmit: () => void; children: ReactNode; actions: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useLayoutEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = ref.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
      opener?.focus();
    };
  }, []);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };
  return (
    <dialog ref={ref} className="dialog" aria-labelledby={id} onCancel={(event) => { event.preventDefault(); onClose(); }}>
      <form className="dialog-form" onSubmit={submit} noValidate>
        <h2 id={id} className="dialog-title">{title}</h2>
        {children}
        <div className="dialog-actions">{actions}</div>
      </form>
    </dialog>
  );
}

export function FieldError({ id, message }: { id: string; message: string | undefined }) {
  return message ? <p id={id} className="field-error">{message}</p> : null;
}

/**
 * One request key per submission: a repeated press or a retry after a network failure reuses the
 * same key and body until a final response arrives; the confirm stays disabled until `handle` has
 * put the outcome on screen.
 */
export function useKeyedSubmit() {
  const pending = useRef<{ key: string; body: string } | null>(null);
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  async function submit<T>(path: string, body: unknown, handle: (result: Result<T>) => Promise<void>): Promise<void> {
    if (running.current) return;
    const text = JSON.stringify(body);
    if (!pending.current || pending.current.body !== text) pending.current = { key: crypto.randomUUID(), body: text };
    running.current = true;
    setBusy(true);
    try {
      const result = await call<T>("POST", path, { body, key: pending.current.key });
      if (result.status !== 0) pending.current = null;
      await handle(result);
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  return { busy, submit };
}
