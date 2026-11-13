// New trace: names a markup trace and makes it the active own trace. A trace never touches the base drawing.
import { useState } from 'react';
import type { TraceView } from '../../../shared/types.ts';
import { ApiError, post } from '../../api.ts';
import { GENERIC_ERROR } from '../../pages/errors.ts';
import { TextField } from '../../ui/Field.tsx';
import { Dialog } from '../../ui/Dialog.tsx';
import { accessRefusal } from '../panels/refusals.ts';
import { useEditor } from '../store.ts';
import '../../styles/panels.css';

export function NewTraceDialog({ onClose }: { onClose: () => void }) {
  const editor = useEditor();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async (): Promise<void> => {
    if (busy || !editor.drawing) return;
    setBusy(true);
    setError(null);
    try {
      const { trace } = await post<{ trace: TraceView }>(`/api/drawings/${editor.drawing.id}/traces`, { name });
      await editor.activateTrace(trace.id);
      await editor.reload();
      onClose();
    } catch (failure) {
      if (!(failure instanceof ApiError)) throw failure;
      setError(failure.fields.name ?? accessRefusal(failure.code) ?? GENERIC_ERROR);
      setBusy(false);
    }
  };

  return (
    <Dialog label="New trace" onClose={onClose}>
      <h2>New trace</h2>
      <form noValidate onSubmit={(event) => { event.preventDefault(); void create(); }}>
        <TextField label="Trace name" value={name} onChange={setName} error={error ?? undefined} />
        <div className="dialog-actions">
          <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" aria-disabled={busy}>Create trace</button>
        </div>
      </form>
    </Dialog>
  );
}
