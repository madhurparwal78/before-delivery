// Save as: copies the drawing's objects, layers and layouts into a new drawing and opens it.
import { useState } from 'react';
import type { DrawingView } from '../../../shared/types.ts';
import { ApiError, post } from '../../api.ts';
import { GENERIC_ERROR } from '../../pages/errors.ts';
import { navigate } from '../../router.tsx';
import { Dialog } from '../../ui/Dialog.tsx';
import { TextField } from '../../ui/Field.tsx';
import { accessRefusal } from '../panels/refusals.ts';
import { useEditor } from '../store.ts';
import '../../styles/panels.css';

const DXF_SUFFIX = /\.dxf$/i;

export function SaveAsDialog({ onClose }: { onClose: () => void }) {
  const { drawing } = useEditor();
  const [name, setName] = useState(`${(drawing?.name ?? '').replace(DXF_SUFFIX, '')} copy.dxf`);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (): Promise<void> => {
    if (busy || !drawing) return;
    setBusy(true);
    setError(null);
    try {
      const copy = await post<{ drawing: Pick<DrawingView, 'id'> }>(`/api/drawings/${drawing.id}/copy`, { name });
      navigate(`/d/${copy.drawing.id}`);
    } catch (failure) {
      if (!(failure instanceof ApiError)) throw failure;
      setError(failure.fields.name ?? accessRefusal(failure.code) ?? GENERIC_ERROR);
      setBusy(false);
    }
  };

  return (
    <Dialog
      label="Save as"
      onClose={onClose}
      initialFocus={(root) => {
        const input = root.querySelector('input');
        input?.select();
        return input;
      }}
    >
      <h2>Save as</h2>
      <form noValidate onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <TextField label="File name" value={name} onChange={setName} error={error ?? undefined} />
        <div className="dialog-actions">
          <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" aria-disabled={busy}>Save</button>
        </div>
      </form>
    </Dialog>
  );
}
