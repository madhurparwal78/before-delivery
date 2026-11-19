import { useState } from "react";
import { uuid } from "../ids.ts";
import type { EditorStore } from "../store/editor.ts";
import { CodeEditor } from "./CodeEditor.tsx";
import { Modal } from "./Modal.tsx";

const TEMPLATE = "function onBeat(ctx) {\n}\n";

export function ScriptPane({ store }: { store: EditorStore }) {
  const [choosing, setChoosing] = useState(false);
  const scripts = store.doc.scripts;
  const script = scripts.find((candidate) => candidate.id === store.selectedScript) ?? undefined;
  const text = script ? (store.drafts.get(script.id) ?? script.source) : "";
  const save = (assetIds = script?.asset_ids ?? []): void => {
    if (!script || !store.canEdit) return;
    store.saveScript(script, text, assetIds);
    store.setDraft(script.id, null);
  };
  const add = (): void => {
    const id = uuid();
    const taken = new Set(scripts.map((candidate) => candidate.name));
    let name = `Script ${scripts.length + 1}`;
    for (let n = scripts.length + 2; taken.has(name); n += 1) name = `Script ${n}`;
    if (store.commit({ type: "script.add", target: id, payload: { name, source: TEMPLATE } }).ok) store.selectScript(id);
  };
  return (
    <div className="split">
      <div className="split-side">
        <div className="pane-bar">
          <button type="button" className="btn" disabled={!store.canEdit} onClick={add}>New script</button>
        </div>
        {scripts.length === 0 ? <p className="muted pad">No scripts yet</p> : null}
        <ul aria-label="Scripts" className="rows">
          {scripts.map((candidate) => (
            <li key={candidate.id} className={candidate.id === script?.id ? "row-item selected" : "row-item"}>
              <button type="button" className="row-pick" onClick={() => store.selectScript(candidate.id)}>
                <span className="bullet" aria-hidden="true" />
                {candidate.name}
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="split-main">
        {script ? (
          <>
            <div className="pane-bar">
              <button type="button" className="btn" disabled={!store.canEdit} onClick={() => save()}>Save script</button>
              <button type="button" className="btn" disabled={!store.canEdit} onClick={() => setChoosing(true)}>Uses assets</button>
              <button type="button" className="btn" disabled={!store.canEdit} onClick={() => store.commit({ type: "script.remove", target: script.id, payload: {} })}>Remove script</button>
              <span className="muted">{script.name}</span>
            </div>
            <CodeEditor
              label="Script source"
              value={text}
              readOnly={!store.canEdit}
              onChange={(value) => store.setDraft(script.id, value)}
              onSave={() => save()}
            />
          </>
        ) : (
          <p className="muted pad">Choose a script or add a new one.</p>
        )}
      </div>
      {choosing && script ? (
        <ScriptAssets store={store} assetIds={script.asset_ids} onClose={() => setChoosing(false)} onDone={(ids) => {
          save(ids);
          setChoosing(false);
        }} />
      ) : null}
    </div>
  );
}

function ScriptAssets({ store, assetIds, onClose, onDone }: { store: EditorStore; assetIds: string[]; onClose: () => void; onDone: (ids: string[]) => void }) {
  const [ticked, setTicked] = useState(new Set(assetIds));
  const textures = store.assets.filter((asset) => asset.kind === "texture" && asset.status === "ready");
  return (
    <Modal title="Script assets" onClose={onClose}>
      {(titleId) => (
        <>
          <h2 id={titleId} className="modal-title small">Script assets</h2>
          {textures.length === 0 ? <p className="muted">No ready textures yet</p> : null}
          {textures.map((asset) => (
            <label key={asset.id} className="check">
              <input
                type="checkbox"
                aria-label={asset.name}
                checked={ticked.has(asset.id)}
                onChange={() => setTicked((previous) => {
                  const next = new Set(previous);
                  if (next.has(asset.id)) next.delete(asset.id);
                  else next.add(asset.id);
                  return next;
                })}
              />
              <span aria-hidden="true">{asset.name}</span>
            </label>
          ))}
          <div className="modal-actions">
            <button type="button" className="btn" onClick={() => onDone([...ticked])}>Done</button>
          </div>
        </>
      )}
    </Modal>
  );
}
