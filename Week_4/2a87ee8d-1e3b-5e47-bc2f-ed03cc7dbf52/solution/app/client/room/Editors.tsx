// The note editor, the small title prompt for clusters and frames, and the options menu.
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Dialog } from "../ui.js";

export type EditorState =
  | { mode: "new"; frameId: string; text: string; facilitatorOnly: boolean }
  | { mode: "edit"; noteId: string; text: string; facilitatorOnly: boolean; image: boolean }
  | { mode: "cluster"; frameId: string };

export function NoteEditor({
  state,
  facilitator,
  onSave,
  onCancel,
}: {
  state: Extract<EditorState, { mode: "new" | "edit" }>;
  facilitator: boolean;
  onSave: (text: string, facilitatorOnly: boolean) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(state.text);
  const [only, setOnly] = useState(state.facilitatorOnly);
  const image = state.mode === "edit" && state.image;
  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!image && text.trim() === "") return;
    onSave(text, only);
  };
  return (
    <Dialog title={state.mode === "new" ? "New note" : "Edit note"} onClose={onCancel}>
      <form onSubmit={submit} className="form" noValidate>
        {!image && (
          <div className="field">
            <label htmlFor="note-text">Note text</label>
            <textarea
              id="note-text"
              data-autofocus
              rows={4}
              maxLength={280}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submit();
              }}
            />
            <p className="field-hint mono">{text.trim().length} / 280</p>
          </div>
        )}
        {facilitator && (
          <label className="check">
            <input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} />
            Facilitator only
          </label>
        )}
        <div className="dialog-actions">
          <button type="submit" className="btn btn-primary">
            Save note
          </button>
          <button type="button" className="btn btn-quiet" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function TitlePrompt({
  label,
  submit,
  initial,
  onSubmit,
  onCancel,
}: {
  label: string;
  submit: string;
  initial: string;
  onSubmit: (title: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial);
  const [busy, setBusy] = useState(false);
  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    await onSubmit(title.trim());
    setBusy(false);
  };
  return (
    <Dialog title={label} onClose={onCancel}>
      <form onSubmit={(e) => void send(e)} className="form" noValidate>
        <div className="field">
          <label htmlFor="title-prompt">{label}</label>
          <input id="title-prompt" data-autofocus maxLength={60} value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="dialog-actions">
          <button type="submit" className="btn btn-primary">
            {busy ? "Saving…" : submit}
          </button>
          <button type="button" className="btn btn-quiet" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** An options menu drawn at screen scale beside the control that opened it. */
export function Menu({ items, onClose, at }: { items: { label: string; run: () => void }[]; onClose: () => void; at: { x: number; y: number } }) {
  const ref = useRef<HTMLUListElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    const outside = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [onClose]);
  const close = () => {
    onClose();
    opener.current?.focus({ preventScroll: true });
  };
  return createPortal(
    <ul
      ref={ref}
      role="menu"
      className="menu"
      style={{ left: Math.min(at.x, window.innerWidth - 200), top: Math.min(at.y, window.innerHeight - 120) }}
      onKeyDown={(e) => {
        const all = [...(ref.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
        const at = all.indexOf(document.activeElement as HTMLElement);
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          all[(at + (e.key === "ArrowDown" ? 1 : all.length - 1)) % all.length]?.focus();
        } else if (e.key === "Escape" || e.key === "Tab") {
          e.preventDefault();
          e.stopPropagation();
          close();
        }
      }}
    >
      {items.map((item) => (
        <li key={item.label} role="none">
          <button type="button" role="menuitem" className="menu-item" onClick={item.run}>
            {item.label}
          </button>
        </li>
      ))}
    </ul>,
    document.body,
  );
}
