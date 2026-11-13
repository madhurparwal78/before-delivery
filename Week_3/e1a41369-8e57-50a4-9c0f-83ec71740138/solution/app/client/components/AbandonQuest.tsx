import { useRef } from "react";
import { Sheet, useSheetClose } from "./Sheet";

function Confirm({ onAbandon }: { onAbandon: () => void }) {
  const close = useSheetClose();
  return (
    <div className="form">
      <p>The party stops this quest and it moves to quest history as abandoned.</p>
      <div className="form-actions">
        <button
          type="button"
          className="btn btn-solid"
          onClick={() => {
            onAbandon();
            close();
          }}
        >
          Abandon
        </button>
        <button type="button" className="btn" onClick={close}>Keep fighting</button>
      </div>
    </div>
  );
}

export function AbandonQuest({ open, setOpen, onAbandon }: { open: boolean; setOpen: (open: boolean) => void; onAbandon: () => void }) {
  const opener = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button type="button" className="btn" ref={opener} onClick={() => setOpen(true)}>Abandon quest</button>
      {open && (
        <Sheet
          title="Abandon quest"
          onClose={() => {
            setOpen(false);
            opener.current?.focus();
          }}
        >
          <Confirm onAbandon={onAbandon} />
        </Sheet>
      )}
    </>
  );
}
