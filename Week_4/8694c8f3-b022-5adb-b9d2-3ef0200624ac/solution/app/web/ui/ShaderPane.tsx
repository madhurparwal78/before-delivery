import { useEffect, useState } from "react";
import { api } from "../api.ts";
import type { EditorStore } from "../store/editor.ts";
import { CodeEditor } from "./CodeEditor.tsx";

interface Version {
  number: number;
  created_at: string;
  restored_from: number | null;
  author: { display_name: string };
}

export function ShaderPane({ store }: { store: EditorStore }) {
  const layer = store.selected?.kind === "shader" ? store.selected : undefined;
  const [versions, setVersions] = useState<Version[]>([]);
  const [saved, setSaved] = useState<string | undefined>(undefined);
  const [viewing, setViewing] = useState<{ number: number; source: string } | null>(null);
  const latest = layer?.shader_version ?? null;

  useEffect(() => {
    setViewing(null);
    setSaved(undefined);
    if (!layer || latest === null) return;
    let alive = true;
    const text = store.shaderText(layer.id, latest);
    if (text !== undefined) setSaved(text);
    else void api.shaderSource(store.setId, layer.id, latest).then((found) => alive && setSaved(found.source), () => undefined);
    return () => {
      alive = false;
    };
  }, [layer?.id, latest, store.shaderChanges]);

  useEffect(() => {
    if (!layer) return;
    let alive = true;
    void api.shaderVersions(store.setId, layer.id).then((found) => alive && setVersions(found.versions), () => undefined);
    return () => {
      alive = false;
    };
  }, [layer?.id, latest, store.shaderChanges]);

  if (!layer) return <p className="muted pad">Select a shader layer to edit its GLSL.</p>;
  const draft = store.drafts.get(layer.id);
  const text = viewing ? viewing.source : (draft ?? saved ?? "");
  const save = (): void => {
    if (viewing || !store.canEdit) return;
    const source = text;
    store.compileShader(source);
    store.saveShader(layer.id, source);
    store.setDraft(layer.id, null);
  };
  return (
    <div className="split">
      <div className="split-main">
        <div className="pane-bar">
          <button type="button" className="btn" disabled={!store.canEdit || viewing !== null} onClick={save}>Save shader</button>
          {viewing ? (
            <>
              <span className="muted">Version {viewing.number} (read-only)</span>
              <button type="button" className="btn" onClick={() => setViewing(null)}>Back to working copy</button>
            </>
          ) : null}
        </div>
        <CodeEditor
          label="GLSL source"
          value={text}
          readOnly={viewing !== null || !store.canEdit}
          errorLines={store.shaderErrors}
          onChange={(value) => store.setDraft(layer.id, value)}
          onSave={save}
        />
      </div>
      <ul aria-label="Shader history" className="history">
        {versions.map((version) => {
          const when = new Date(version.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
          return (
            <li key={version.number} className={viewing?.number === version.number ? "history-row selected" : "history-row"}>
              <button
                type="button"
                className="history-pick"
                onClick={() => void api.shaderSource(store.setId, layer.id, version.number).then((found) => setViewing({ number: version.number, source: found.source }))}
              >
                <span className="bullet" aria-hidden="true" />
                <span className="history-main">Version {version.number}</span>
                <span className="muted">{version.author.display_name} {when}</span>
                {version.restored_from !== null ? <span className="muted">Restored from version {version.restored_from}</span> : null}
              </button>
              <button
                type="button"
                className="btn mini-text"
                aria-label={`Restore version ${version.number}`}
                disabled={!store.canEdit || version.number === latest}
                onClick={() => {
                  setViewing(null);
                  store.restoreShader(layer.id, version.number);
                }}
              >
                Restore
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
