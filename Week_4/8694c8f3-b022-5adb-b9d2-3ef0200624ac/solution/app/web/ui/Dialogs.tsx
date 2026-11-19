import { useState } from "react";
import type { FormEvent } from "react";
import { api, ApiFailure } from "../api.ts";
import type { Conflict, EditorStore } from "../store/editor.ts";
import { Modal } from "./Modal.tsx";

export function NewSetDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name") ?? "");
    setBusy(true);
    try {
      const doc = await api.createSet(name);
      onCreated(doc.set.id);
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
      setProblem(error.detail.fields?.["name"] ?? error.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="New set" onClose={onClose}>
      {(titleId) => (
        <form noValidate onSubmit={(event) => void submit(event)}>
          <h2 id={titleId} className="modal-title small">New set</h2>
          <label className="row">
            <span className="row-label">Name</span>
            <span className="row-value">
              <input className="text-input" name="name" type="text" role="textbox" aria-label="Set name" autoComplete="off" aria-invalid={problem ? true : undefined} onChange={() => setProblem("")} />
              {problem ? <span className="field-error">{problem}</span> : null}
            </span>
          </label>
          <div className="row">
            <span className="row-label">Starter</span>
            <span className="row-value">
              <label className="check">
                <input type="radio" name="starter" value="blank-stage" aria-label="Blank stage" defaultChecked />
                <span aria-hidden="true">Blank stage</span>
              </label>
            </span>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn" disabled={busy}>Create set</button>
          </div>
        </form>
      )}
    </Modal>
  );
}

export function ConflictDialog({ store, conflict }: { store: EditorStore; conflict: Conflict }) {
  return (
    <Modal title="Someone changed this layer first" role="alertdialog" onClose={() => store.resolveConflict("keep")}>
      {(titleId) => (
        <>
          <h2 id={titleId} className="modal-title small">Someone changed this layer first</h2>
          <p className="modal-body">{conflict.changedBy} changed {conflict.targetName} before your edit arrived.</p>
          <div className="modal-actions">
            <button type="button" className="btn" data-autofocus onClick={() => store.resolveConflict("keep")}>Keep theirs</button>
            <button type="button" className="btn" onClick={() => store.resolveConflict("reapply")}>Reapply mine</button>
          </div>
        </>
      )}
    </Modal>
  );
}

const SHORTCUTS: [string, string][] = [
  ["Space", "Play or pause"],
  ["W, E, R", "Move, Rotate, Scale"],
  ["K", "Key the focused row's property"],
  ["Ctrl+S or Cmd+S", "Save in the shader or script editor"],
  ["Enter or C", "Connect a wire from a focused graph node"],
  ["Alt+arrows", "Reorder layers in the tree"],
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose}>
      {(titleId) => (
        <>
          <h2 id={titleId} className="modal-title small">Keyboard shortcuts</h2>
          <dl className="shortcuts">
            {SHORTCUTS.map(([keys, action]) => (
              <div key={keys} className="shortcut"><dt>{keys}</dt><dd>{action}</dd></div>
            ))}
          </dl>
          <div className="modal-actions">
            <button type="button" className="btn" onClick={onClose}>Done</button>
          </div>
        </>
      )}
    </Modal>
  );
}
