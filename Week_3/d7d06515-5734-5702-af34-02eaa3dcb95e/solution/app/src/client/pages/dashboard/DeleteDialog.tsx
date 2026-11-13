// alertdialog "Delete <name>?" (brief: Row actions). A folder that still holds items is refused inline.
import { useState } from 'react';
import { copy, COPY } from '../../../shared/copy.ts';
import type { FolderItem } from '../../../shared/types.ts';
import { del } from '../../api.ts';
import { Dialog } from '../../ui/Dialog.tsx';
import { announce } from '../../ui/announce.tsx';
import { deleteFailure } from '../errors.ts';

interface DeleteDialogProps {
  item: FolderItem;
  onClose: () => void;
  onDeleted: () => void;
  returnFocus: () => HTMLElement | null;
}

export function DeleteDialog({ item, onClose, onDeleted, returnFocus }: DeleteDialogProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  const remove = async (): Promise<void> => {
    if (pending) return;
    setPending(true);
    setError('');
    try {
      await del(item.kind === 'folder' ? `/api/folders/${item.id}` : `/api/drawings/${item.id}`);
      announce(copy.deleted(item.name));
      onDeleted();
    } catch (failure) {
      const message = deleteFailure(failure, item.name);
      setError(message);
      announce(message);
      setPending(false);
    }
  };

  return (
    <Dialog
      label={`Delete ${item.name}?`}
      role="alertdialog"
      onClose={onClose}
      returnFocus={returnFocus}
      initialFocus={(root) => root.querySelector<HTMLElement>('[data-cancel]')}
    >
      <h2>Delete {item.name}?</h2>
      <p>{COPY.deleteBody}</p>
      {error ? <p className="form-error">{error}</p> : null}
      <div className="dialog-actions">
        <button type="button" data-cancel className="btn btn-outline" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary" aria-disabled={pending || undefined} onClick={() => void remove()}>Delete</button>
      </div>
    </Dialog>
  );
}
