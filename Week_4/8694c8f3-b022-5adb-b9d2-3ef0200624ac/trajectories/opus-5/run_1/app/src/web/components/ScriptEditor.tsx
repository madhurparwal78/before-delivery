import { useState } from 'react';
import { store } from '../store.js';
import { Dialog, useStoreState } from './common.js';

export function ScriptEditor() {
  const state = useStoreState();
  const doc = state.doc;
  const [assetDialog, setAssetDialog] = useState(false);
  const [ticked, setTicked] = useState<string[]>([]);
  if (doc === null) return null;
  const script = doc.scripts.find((entry) => entry.id === state.scriptSelection) ?? null;
  const textures = state.assets.filter((asset) => asset.kind === 'texture' && asset.status === 'ready');

  const save = (assetIds?: string[]): void => {
    if (script === null) return;
    store.commit({
      target: script.id,
      type: 'script.save',
      payload: { source: state.scriptDraft, asset_ids: assetIds ?? script.asset_ids },
      baseVersion: script.version,
    });
    store.scriptHost.load(
      doc.scripts.map((entry) =>
        entry.id === script.id ? { ...entry, source: state.scriptDraft, version: entry.version + 1 } : entry,
      ),
    );
    store.markDirty();
  };

  return (
    <div className="split">
      <div>
        <div style={{ display: 'flex', gap: '4px', paddingBottom: '4px' }}>
          <button type="button" className="row-button" onClick={() => save()} disabled={script === null}>
            Save script
          </button>
          <button
            type="button"
            className="row-button"
            disabled={script === null}
            onClick={() => {
              setTicked(script?.asset_ids ?? []);
              setAssetDialog(true);
            }}
          >
            Uses assets
          </button>
          <span className="status-line">{state.regions.scriptStatus}</span>
        </div>
        <div className="code-wrap">
          <textarea
            aria-label="Script source"
            spellCheck={false}
            value={state.scriptDraft}
            onChange={(event) => store.patch({ scriptDraft: event.target.value })}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
                event.preventDefault();
                save();
              }
            }}
          />
        </div>
      </div>
      <div>
        <button
          type="button"
          className="row-button"
          onClick={() => {
            const id = crypto.randomUUID();
            store.commit({
              target: id,
              type: 'script.add',
              payload: { name: `Script ${doc.scripts.length + 1}`, source: '' },
            });
            store.patch({ scriptSelection: id, scriptDraft: '' });
          }}
        >
          New script
        </button>
        <ul className="list-rows" aria-label="Scripts">
          {doc.scripts.length === 0 ? <li className="status-line">No scripts yet</li> : null}
          {doc.scripts.map((entry) => (
            <li
              key={entry.id}
              className={entry.id === script?.id ? 'list-row selected' : 'list-row'}
              onClick={() => store.patch({ scriptSelection: entry.id, scriptDraft: entry.source })}
            >
              <span className="grow">{entry.name}</span>
              <span className="dim">{`v${entry.version}`}</span>
            </li>
          ))}
        </ul>
      </div>
      {assetDialog ? (
        <Dialog title="Script assets" onClose={() => setAssetDialog(false)}>
          {textures.map((asset) => (
            <label className="checkrow" key={asset.id}>
              <input
                type="checkbox"
                checked={ticked.includes(asset.id)}
                onChange={(event) =>
                  setTicked(
                    event.target.checked
                      ? [...ticked, asset.id]
                      : ticked.filter((entry) => entry !== asset.id),
                  )
                }
              />
              {asset.name}
            </label>
          ))}
          <div className="dialog-actions">
            <button
              type="button"
              className="row-button"
              onClick={() => {
                save(ticked);
                setAssetDialog(false);
              }}
            >
              Done
            </button>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}

export function ConsolePanel() {
  const state = useStoreState();
  return (
    <div className="console-log" role="log" aria-label="Console" aria-live="polite">
      {state.consoleLines.map((line, index) => (
        <div key={index}>{line}</div>
      ))}
    </div>
  );
}
