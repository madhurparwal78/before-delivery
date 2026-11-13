// alertdialog "Edit conflict": a stale edit was refused and nothing was applied.
import { copy } from '../../../shared/copy.ts';
import { Dialog } from '../../ui/Dialog.tsx';
import { useEditorState, useEditorStore } from '../store.ts';

export function ConflictDialog() {
  const store = useEditorStore();
  const { conflict } = useEditorState();
  if (!conflict) return null;
  const loadLatest = (): void => {
    store.reload().catch(() => undefined);
  };
  return (
    <Dialog label="Edit conflict" role="alertdialog" onClose={loadLatest} returnFocus={() => store.commandInput}>
      <h2>Edit conflict</h2>
      <p>{copy.conflict(conflict.changed)}</p>
      <div className="dialog-actions">
        <button type="button" className="btn btn-primary" onClick={loadLatest}>Load latest</button>
      </div>
    </Dialog>
  );
}
