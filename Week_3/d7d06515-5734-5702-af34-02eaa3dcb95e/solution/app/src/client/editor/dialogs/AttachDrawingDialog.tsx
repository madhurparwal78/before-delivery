// Attach drawing: pick another drawing of the workspace to draw into this one as an external reference.
import { useEffect, useState } from 'react';
import type { FolderItem } from '../../../shared/types.ts';
import { ApiError, get } from '../../api.ts';
import { GENERIC_ERROR } from '../../pages/errors.ts';
import { Dialog } from '../../ui/Dialog.tsx';
import { LoadingStrokes } from '../../ui/LoadingStrokes.tsx';
import { useEditor } from '../store.ts';
import { firstFieldMessage } from '../panels/refusals.ts';
import '../../styles/panels.css';

interface Choice { id: string; name: string }
interface Folder { items: FolderItem[] }

/** Every drawing of the workspace, found by walking My Drawings and its subfolders. */
async function workspaceDrawings(folderId: string): Promise<Choice[]> {
  const { items } = await get<Folder>(`/api/folders/${folderId}`);
  const nested = await Promise.all(items.filter((item) => item.kind === 'folder').map((item) => workspaceDrawings(item.id)));
  return [...items.filter((item) => item.kind === 'drawing').map((item) => ({ id: item.id, name: item.name })), ...nested.flat()];
}

export function AttachDrawingDialog({ onClose }: { onClose: () => void }) {
  const editor = useEditor();
  const [choices, setChoices] = useState<Choice[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const currentId = editor.drawing?.id;

  useEffect(() => {
    let live = true;
    workspaceDrawings('root')
      .then((found) => { if (live) setChoices(found.filter((choice) => choice.id !== currentId).sort((a, b) => a.name.localeCompare(b.name))); })
      .catch(() => { if (live) setError(GENERIC_ERROR); });
    return () => { live = false; };
  }, [currentId]);

  const attach = async (): Promise<void> => {
    const choice = choices?.find((item) => item.id === picked);
    if (!choice || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await editor.runCommand('XREF', { op: 'attach', drawing_id: choice.id });
      if (result) editor.announce(`${choice.name} attached.`);
      onClose();
    } catch (failure) {
      if (!(failure instanceof ApiError)) throw failure;
      setError(firstFieldMessage(failure) ?? GENERIC_ERROR);
      setBusy(false);
    }
  };

  return (
    <Dialog label="Attach drawing" onClose={onClose}>
      <h2>Attach drawing</h2>
      {choices === null && !error ? <LoadingStrokes /> : null}
      {choices ? (
        <div role="radiogroup" aria-label="Drawing" className="choice-list">
          {choices.map((choice) => (
            <label key={choice.id} className="choice">
              <input type="radio" name="xref-drawing" checked={picked === choice.id} onChange={() => setPicked(choice.id)} />
              <span>{choice.name}</span>
            </label>
          ))}
        </div>
      ) : null}
      {error ? <p role="alert" className="field-error">{error}</p> : null}
      <div className="dialog-actions">
        <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary" aria-disabled={!picked || busy} onClick={() => void attach()}>Attach</button>
      </div>
    </Dialog>
  );
}
