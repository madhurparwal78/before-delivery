import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { ApiErrorBody } from '../../shared/api.js';
import { failureOf } from '../api.js';
import { raise, clearError } from '../notices.js';
import { Dialog } from './Dialog.js';

// A file upload dialog: roster or logo. Refusals stay in the dialog and in the lemon band; focus stays in the dialog.
export function UploadDialog({ title, fileLabel, submitLabel, accept, send, onDone, onRefused, onClose }: {
  title: string;
  fileLabel: string;
  submitLabel: string;
  accept?: string;
  send: (file: File) => Promise<void>;
  onDone: () => void;
  onRefused?: (body: ApiErrorBody) => boolean;
  onClose: () => void;
}): ReactNode {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const restore = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!busy) restore.current?.focus();
  }, [busy]);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!file) return;
    clearError();
    restore.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setBusy(true);
    setStatus('Saving...');
    try {
      await send(file);
      onDone();
    } catch (error) {
      const failure = failureOf(error);
      if (onRefused?.(failure.body)) return;
      setStatus(failure.message);
      raise(failure.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog label={title} onClose={onClose}>
      <form onSubmit={(event) => void submit(event)}>
        <div className="field">
          <label htmlFor="upload-file">{fileLabel}</label>
          <input id="upload-file" type="file" accept={accept} data-autofocus="" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
        </div>
        <p role="status" aria-label="Dialog status" className="dialog-status">{status}</p>
        <div className="dialog-actions">
          <button type="submit" className="btn" disabled={busy}>{submitLabel}</button>
          <button type="button" className="btn btn-quiet" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Dialog>
  );
}
