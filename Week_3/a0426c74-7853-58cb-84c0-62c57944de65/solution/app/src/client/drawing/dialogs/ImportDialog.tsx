import { useState } from 'react';
import type { ChangeEvent } from 'react';
import { READING_FILE, importPreview, importRename } from '../../../shared/copy.ts';
import { onRefusal, sendBytes } from '../../api.ts';
import { Button, Dialog } from '../../ui/index.ts';
import '../../styles/drawing/forms.css';

interface ImportUpload {
  import_id: string;
  adds: { entities: number; layers: number; blocks: number };
  renames: { from: string; to: string }[];
}

type ImportState =
  | { phase: 'idle' }
  | { phase: 'reading' }
  | { phase: 'lines'; lines: readonly string[] }
  | { phase: 'refused'; message: string }
  | { phase: 'preview'; upload: ImportUpload };

interface ImportDialogProps {
  drawingId: string;
  /** a storage action's sentence for `status "Storage notice"` and the announcements */
  notify: (sentence: string) => void;
  /** Merge: one `import_merge` group; resolves when the group is confirmed */
  onMerge: (importId: string, entities: number) => Promise<void>;
  onClose: () => void;
}

/** `dialog "Import preview"`: it already holds the file input; errors, the preview and Merge render inside it. */
export function ImportDialog({ drawingId, notify, onMerge, onClose }: ImportDialogProps) {
  const [state, setState] = useState<ImportState>({ phase: 'idle' });

  async function read(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    if (!file) return;
    setState({ phase: 'reading' });
    notify(READING_FILE);
    await onRefusal(
      async () => setState({ phase: 'preview', upload: await sendBytes<ImportUpload>(`/api/drawings/${drawingId}/imports`, file) }),
      (failure) => {
        if (failure.code === 'storage_unavailable') onClose();
        else if (failure.code === 'parse_failed') setState({ phase: 'lines', lines: failure.lines ?? [] });
        else setState({ phase: 'refused', message: failure.message });
        notify(failure.message);
      },
    );
  }

  return (
    <Dialog name="Import preview" onClose={onClose}>
      <div className="form">
        <input className="field" type="file" aria-label="Plotfold text file" data-autofocus onChange={(event) => void read(event)} />
        {state.phase === 'lines' ? (
          <ul className="error-list" role="list" aria-label="Import errors">
            {state.lines.map((line) => <li key={line}>{line}</li>)}
          </ul>
        ) : null}
        {state.phase === 'refused' ? <p>{state.message}</p> : null}
        {state.phase === 'preview' ? (
          <div className="error-list">
            <p>{importPreview(state.upload.adds.entities, state.upload.adds.layers, state.upload.adds.blocks)}</p>
            {state.upload.renames.map((rename) => <p key={rename.from}>{importRename(rename.from, rename.to)}</p>)}
          </div>
        ) : null}
        <div className="actions">
          {state.phase === 'preview' ? (
            <Button primary onClick={() => void onMerge(state.upload.import_id, state.upload.adds.entities)}>Merge</Button>
          ) : null}
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </Dialog>
  );
}
