import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp, documentPayload } from '../lib/app';
import { announce } from '../lib/announce';
import * as db from '../lib/store';
import { Dialog } from '../components/ui';
import type { DocumentMeta } from '../../shared/domain';

export function TrashScreen() {
  const documents = useApp((s) => s.documents);
  const blocks = useApp((s) => s.blocks);
  const markChange = useApp((s) => s.markChange);
  const reload = useApp((s) => s.reload);
  const [dialogDoc, setDialogDoc] = useState<DocumentMeta | null>(null);
  const openerRef = useRef<HTMLButtonElement>(null);

  const closeDialog = () => {
    setDialogDoc(null);
    openerRef.current?.focus();
  };

  const trashed = documents.filter((d) => d.trashed && !d.journal);

  const restore = async (doc: DocumentMeta) => {
    const updated = { ...doc, trashed: false };
    await db.putDocument(updated);
    await markChange('document', doc.id, doc.id, false, documentPayload(updated));
    await reload();
    announce(`Restored "${doc.title || 'Untitled'}".`);
  };

  // Delete forever is final: it removes the document from search, the canvas,
  // Trash and any share link, and beats any offline edit.
  const deleteForever = async (doc: DocumentMeta) => {
    for (const b of blocks.filter((b) => b.documentId === doc.id)) {
      await db.deleteBlock(b.id);
    }
    await db.deleteRecordsForDocument(doc.id);
    await markChange('document', doc.id, doc.id, true, { id: doc.id, gone: true });
    await reload();
    announce(`Deleted "${doc.title || 'Untitled'}" forever.`);
  };

  return (
    <div>
      <div className="heading-row">
        <h1>Trash</h1>
      </div>
      {trashed.length === 0 ? (
        <div className="empty-state paper">Trash is empty.</div>
      ) : (
        <div className="paper">
          {trashed.map((doc) => (
            <div key={doc.id} className="list-row trash-row">
              <Link className="title-link" to={`/doc/${doc.id}`} style={{ flex: 1 }}>
                {doc.title || 'Untitled'}
              </Link>
              <span className="meta">{new Date(doc.updatedAt).toLocaleDateString()}</span>
              <button className="button" onClick={() => restore(doc)} aria-label={`Restore ${doc.title || 'Untitled'}`}>
                Restore
              </button>
              <button
                ref={openerRef}
                className="button"
                onClick={() => setDialogDoc(doc)}
                aria-label={`Delete forever ${doc.title || 'Untitled'}`}
              >
                Delete forever
              </button>
            </div>
          ))}
        </div>
      )}
      {dialogDoc && (
        <Dialog label="Delete forever" onClose={closeDialog}>
          <h2>Delete forever</h2>
          <p>Delete &quot;{dialogDoc.title || 'Untitled'}&quot; forever? This cannot be undone.</p>
          <div className="row">
            <button className="button" onClick={closeDialog}>Cancel</button>
            <button
              className="button accent-button"
              onClick={() => {
                const doc = dialogDoc;
                setDialogDoc(null);
                void deleteForever(doc);
              }}
            >
              Delete forever
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
