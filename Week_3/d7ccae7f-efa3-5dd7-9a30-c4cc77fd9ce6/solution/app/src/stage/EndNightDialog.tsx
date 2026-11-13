import { useEffect, useRef } from "react";
import { trapTab } from "../lib/dialog";

type Props = { open: boolean; onKeepGoing: () => void; onEnd: () => void };

export function EndNightDialog({ open, onKeepGoing, onEnd }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const keep = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      element.showModal();
      keep.current?.focus();
    }
    if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      className="end-dialog panel"
      aria-labelledby="end-night-title"
      onCancel={(event) => {
        event.preventDefault();
        onKeepGoing();
      }}
      onKeyDown={(event) => dialog.current && trapTab(event.nativeEvent, dialog.current)}
    >
      <h2 id="end-night-title">End the night?</h2>
      <p>Everyone&apos;s seat closes and the night moves to Past nights.</p>
      <div className="dialog-actions">
        <button type="button" ref={keep} onClick={onKeepGoing}>
          Keep going
        </button>
        <button type="button" className="button-primary" onClick={onEnd}>
          End night
        </button>
      </div>
    </dialog>
  );
}
