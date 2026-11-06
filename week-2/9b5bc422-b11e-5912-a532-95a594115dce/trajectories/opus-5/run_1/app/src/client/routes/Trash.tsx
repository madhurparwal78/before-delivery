import { useState } from 'react';
import { textOf } from '../../domain/blocks.ts';
import { announce as copy, empty } from '../../domain/copy.ts';
import { Dialog } from '../components/Dialog.tsx';
import { useStore } from '../hooks.ts';
import { documents } from '../store/actions.ts';
import { announce, forgetDocuments } from '../store/store.ts';

export function Trash() {
  const state = useStore();
  const [confirmFor, setConfirmFor] = useState<string | null>(null);

  const trashed = [...state.workspace.documents.values()]
    .filter((document) => document.kind === 'document' && document.trashed)
    .sort((a, b) => (a.trashedAt ?? '') < (b.trashedAt ?? '') ? 1 : -1);

  const confirmTitle = confirmFor
    ? textOf(state.workspace.documents.get(confirmFor)?.title ?? { values: [] }) || 'Untitled'
    : '';

  return (
    <div className="screen">
      <h1 className="display">Trash</h1>
      {!trashed.length && <p className="empty">{empty.trashEmpty}</p>}
      <ul aria-label="Trash" className="trash-rows">
        {trashed.map((document) => {
          const title = textOf(document.title) || 'Untitled';
          return (
            <li key={document.id} className="paper trash-row">
              <span className="trash-title">{title}</span>
              <span className="trash-date">{(document.trashedAt ?? '').slice(0, 10)}</span>
              <span className="trash-actions">
                <button
                  type="button"
                  className="button"
                  aria-label={`Restore ${title}`}
                  onClick={() => {
                    void documents.setTrashed(document.id, false);
                    announce(copy.restored(title));
                  }}
                >
                  Restore
                </button>
                <button
                  type="button"
                  className="button"
                  aria-label={`Delete forever ${title}`}
                  onClick={() => setConfirmFor(document.id)}
                >
                  Delete forever
                </button>
              </span>
            </li>
          );
        })}
      </ul>

      {confirmFor && (
        <Dialog name="Delete forever" onClose={() => setConfirmFor(null)}>
          <h2 className="display">Delete forever</h2>
          <p>{empty.deleteDialogBody(confirmTitle)}</p>
          <div className="dialog-actions">
            <button
              type="button"
              className="button"
              data-autofocus
              onClick={() => {
                const documentId = confirmFor;
                setConfirmFor(null);
                void forgetDocuments([documentId]);
                announce(copy.deletedForever(confirmTitle));
              }}
            >
              Delete forever
            </button>
            <button type="button" className="button" onClick={() => setConfirmFor(null)}>
              Cancel
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
