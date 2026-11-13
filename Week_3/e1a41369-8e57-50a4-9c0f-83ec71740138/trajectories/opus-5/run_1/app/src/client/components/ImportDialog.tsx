import { useState } from 'react';
import type { ImportLineError } from '../../shared/types.js';
import { ApiFailure, api } from '../api.js';
import { GENERIC_ERROR, refreshTasks, showAlert } from '../store.js';
import { Dialog } from './Dialog.js';

export function importedText(count: number): string {
  return count === 1 ? 'Imported 1 task' : `Imported ${count} tasks`;
}

export function rejectedText(count: number): string {
  return count === 1 ? 'Rejected: 1 error' : `Rejected: ${count} errors`;
}

export function ImportDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<ImportLineError[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const send = (): void => {
    if (!file) return;
    setBusy(true);
    setErrors([]);
    setStatus(null);
    showAlert(null);
    void api
      .upload(file)
      .then(async (record) => {
        setStatus(importedText(record.taskCount));
        await refreshTasks();
      })
      .catch((failure: unknown) => {
        if (failure instanceof ApiFailure) {
          if (failure.status === 422 && Array.isArray(failure.body.errors)) {
            setErrors(failure.body.errors as ImportLineError[]);
            return;
          }
          if (failure.status === 413) showAlert('The file is larger than 100,000 bytes.');
          else if (failure.status === 415) showAlert('Choose a .deedlist text file.');
          else if (failure.status === 503) showAlert('File storage is unavailable. Nothing was imported.');
          else showAlert(GENERIC_ERROR);
          return;
        }
        showAlert(GENERIC_ERROR);
      })
      .finally(() => setBusy(false));
  };

  return (
    <Dialog name="Import tasks" onClose={onClose}>
      <h2 className="dialog-title">Import tasks</h2>
      <div className="field">
        <label htmlFor="import-file">Task list file</label>
        <input
          id="import-file"
          type="file"
          accept=".deedlist"
          onChange={(event) => setFile(event.currentTarget.files?.[0] ?? null)}
        />
      </div>
      <div className="dialog-actions">
        <button type="button" className="strong" disabled={busy || file === null} onClick={send}>
          {busy ? 'Importing...' : 'Import'}
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
      {status ? <p role="status">{status}</p> : null}
      {errors.length > 0 ? (
        <ul className="import-errors" role="list" aria-label="Import errors">
          {errors.map((error) => (
            <li key={`${error.line}-${error.message}`}>{error.message}</li>
          ))}
        </ul>
      ) : null}
    </Dialog>
  );
}
