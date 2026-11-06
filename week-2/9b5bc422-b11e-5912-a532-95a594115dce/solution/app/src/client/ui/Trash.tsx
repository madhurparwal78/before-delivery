import { useState } from "react";
import { shortDate } from "../domain/dates.ts";
import type { WorkspaceRecord } from "../domain/types.ts";
import { deleteForever, restoreDocument } from "../store/actions.ts";
import { trashedDocuments } from "../store/workspace.ts";
import { Dialog, Empty } from "./common.tsx";
import { untitled } from "./DocumentList.tsx";

export function Trash() {
  const [deleting, setDeleting] = useState<WorkspaceRecord<"document"> | null>(null);
  const trashed = trashedDocuments();
  return (
    <div className="screen">
      <h1 className="screen-title">Trash</h1>
      <section className="paper list-panel">
        {trashed.length === 0 ? <Empty text="Trash is empty." /> : (
          <ul className="rows rows-list">
            {trashed.map(({ document, trashedAt }) => {
              const name = untitled(document.fields.title);
              return (
                <li key={document.id} className="row trash-row">
                  <div className="row-main">
                    <span className="row-title">{name}</span>
                    <span className="row-date">{shortDate(trashedAt)}</span>
                  </div>
                  <div className="trash-actions">
                    <button type="button" className="button" aria-label={`Restore ${name}`} onClick={() => restoreDocument(document.id, name)}>Restore</button>
                    <button type="button" className="button" aria-label={`Delete forever ${name}`} onClick={() => setDeleting(document)}>Delete forever</button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {deleting && (
        <Dialog name="Delete forever" onClose={() => setDeleting(null)}>
          <p>Delete "{untitled(deleting.fields.title)}" forever? This cannot be undone.</p>
          <div className="dialog-actions">
            <button
              type="button"
              className="button"
              onClick={() => {
                deleteForever(deleting.id, untitled(deleting.fields.title));
                setDeleting(null);
              }}
            >
              Delete forever
            </button>
            <button type="button" className="button" onClick={() => setDeleting(null)}>Cancel</button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
