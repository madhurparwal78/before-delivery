import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { store } from '../store.js';
import { useStoreState } from './common.js';
import { findLayer } from '../document.js';

function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function ShaderEditor() {
  const state = useStoreState();
  const layer = findLayer(state.doc, state.selection);
  const [viewed, setViewed] = useState<{ number: number; source: string } | null>(null);

  useEffect(() => {
    setViewed(null);
  }, [state.selection]);

  if (layer === null || layer.kind !== 'shader') {
    return <p className="status-line">Select a shader layer to edit its GLSL.</p>;
  }

  const save = (): void => {
    const source = state.shaderDraft;
    store.region('shaderCompile', 'Compiling');
    const result = store.renderer?.compile(source) ?? { ok: true as const };
    if (result.ok) {
      store.patch({ shaderErrors: [] });
      store.region('shaderCompile', 'Compiled');
      store.shaderSources.set(layer.id, source);
    } else {
      store.patch({ shaderErrors: result.errors });
      const first = result.errors[0];
      store.region('shaderCompile', `Line ${first?.line ?? 1}: ${first?.message ?? 'Compile failed'}`);
    }
    store.commit(
      {
        target: layer.id,
        type: 'shader.save',
        payload: { source },
        baseVersion: layer.version,
      },
      () => void store.refreshShaderVersions(layer.id),
    );
    store.markDirty();
  };

  const lines = (viewed?.source ?? state.shaderDraft).split('\n');
  const badLines = new Set(state.shaderErrors.map((error) => error.line));

  return (
    <div className="split">
      <div>
        <div className="panel-actions" style={{ display: 'flex', gap: '4px', paddingBottom: '4px' }}>
          <button type="button" className="row-button" onClick={save}>
            Save shader
          </button>
          {viewed === null ? null : (
            <button type="button" className="row-button" onClick={() => setViewed(null)}>
              Back to working copy
            </button>
          )}
          <span className="status-line">{state.regions.shaderCompile}</span>
        </div>
        <div className="code-wrap">
          <div className="gutter" aria-hidden="true">
            {lines.map((_line, index) => (
              <div key={index} className={badLines.has(index + 1) ? 'bad' : undefined}>
                {index + 1}
              </div>
            ))}
          </div>
          <textarea
            aria-label="GLSL source"
            spellCheck={false}
            readOnly={viewed !== null}
            value={viewed?.source ?? state.shaderDraft}
            onChange={(event) => store.patch({ shaderDraft: event.target.value })}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
                event.preventDefault();
                save();
              }
            }}
          />
        </div>
      </div>
      <ul className="list-rows" aria-label="Shader history">
        {state.shaderVersions.map((version) => (
          <li key={version.number} className="list-row">
            <button
              type="button"
              className="link-button grow"
              onClick={() => {
                void api
                  .getShaderVersion(store.setId, layer.id, version.number)
                  .then((result) => setViewed({ number: result.number, source: result.source }));
              }}
            >
              {`Version ${version.number}`}
            </button>
            <span className="dim">{version.author.display_name}</span>
            <span className="dim">{clockTime(version.created_at)}</span>
            {version.restored_from === null ? null : (
              <span className="dim">{`Restored from version ${version.restored_from}`}</span>
            )}
            <button
              type="button"
              className="row-button"
              onClick={() => {
                store.commit(
                  {
                    target: layer.id,
                    type: 'shader.restore',
                    payload: { from_version: version.number },
                    baseVersion: layer.version,
                  },
                  () => void store.refreshShaderVersions(layer.id),
                );
                void api.getShaderVersion(store.setId, layer.id, version.number).then((result) => {
                  store.shaderSources.set(layer.id, result.source);
                  store.patch({ shaderDraft: result.source });
                  setViewed(null);
                  store.markDirty();
                });
              }}
            >
              {`Restore version ${version.number}`}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
