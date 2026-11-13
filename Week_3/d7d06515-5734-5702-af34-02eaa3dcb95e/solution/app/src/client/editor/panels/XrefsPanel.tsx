// Xrefs tab: external references with their status, and Attach drawing.
import { useState } from 'react';
import type { XrefStatus } from '../../../shared/types.ts';
import { ApiError } from '../../api.ts';
import { GENERIC_ERROR } from '../../pages/errors.ts';
import { AttachDrawingDialog } from '../dialogs/AttachDrawingDialog.tsx';
import { useEditor } from '../store.ts';
import { firstFieldMessage } from './refusals.ts';
import '../../styles/panels.css';

const STATUS_WORDS: Record<XrefStatus, string> = { loaded: 'Loaded', unloaded: 'Unloaded', not_found: 'Not found' };

export function XrefsPanel() {
  const editor = useEditor();
  const [attaching, setAttaching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const readOnly = !editor.canEditBase;

  const act = async (op: 'unload' | 'reload' | 'detach', xrefId: string): Promise<void> => {
    setError(null);
    try {
      await editor.runCommand('XREF', { op, xref_id: xrefId });
    } catch (failure) {
      if (!(failure instanceof ApiError)) throw failure;
      setError(firstFieldMessage(failure) ?? GENERIC_ERROR);
    }
  };

  return (
    <div className="panel">
      <h3 className="panel-heading">External references</h3>
      {error ? <p role="alert" className="panel-alert">{error}</p> : null}
      <ul className="panel-list" aria-label="External references">
        <li className="panel-list-action">
          <button type="button" className="btn btn-outline" disabled={readOnly} onClick={() => setAttaching(true)}>Attach drawing</button>
        </li>
        {(editor.drawing?.xrefs ?? []).map((xref) => (
          <li key={xref.id} className="panel-item">
            <p className="panel-item-text">{xref.name} · {STATUS_WORDS[xref.status]}</p>
            <div className="panel-item-actions">
              <button type="button" className="btn btn-outline" disabled={readOnly || xref.status !== 'loaded'} aria-label={`Unload ${xref.name}`} onClick={() => void act('unload', xref.id)}>
                Unload
              </button>
              <button type="button" className="btn btn-outline" disabled={readOnly || xref.status !== 'unloaded'} aria-label={`Reload ${xref.name}`} onClick={() => void act('reload', xref.id)}>
                Reload
              </button>
              <button type="button" className="btn btn-outline" disabled={readOnly} aria-label={`Detach ${xref.name}`} onClick={() => void act('detach', xref.id)}>
                Detach
              </button>
            </div>
          </li>
        ))}
      </ul>
      {attaching ? <AttachDrawingDialog onClose={() => setAttaching(false)} /> : null}
    </div>
  );
}
