// The History tab: the open note's server revisions, newest first, with restore.
import { useEffect, useRef, useState } from "react";
import { History as HistoryIcon } from "lucide-react";
import { HttpError } from "./api.ts";
import { noteHistory, reloadHead, restoreRevision } from "./sync.ts";
import { notebookOf, useApp, type Note } from "./store.ts";
import { Modal } from "./ui.tsx";
import { formatWhen } from "../shared/time.ts";
import type { Revision } from "../shared/types.ts";

export function History({ note }: { note: Note | undefined }) {
  const app = useApp();
  const vaultId = note ? notebookOf(note)?.vaultId : null;
  const [revisions, setRevisions] = useState<Revision[] | null>(null);
  const [asking, setAsking] = useState<number | null>(null);
  const [status, setStatus] = useState("");
  const restoreButton = useRef<HTMLButtonElement>(null);
  const zone = app.session.kind === "signed_in" ? app.session.account.time_zone : "UTC";
  const synced = Boolean(note && vaultId && note.ackRev !== null);

  const load = () => {
    if (!note || !vaultId) return;
    noteHistory(vaultId, note.id).then(setRevisions).catch(() => setRevisions([]));
  };
  useEffect(() => {
    setRevisions(null);
    setStatus("");
  }, [note?.id]);
  useEffect(load, [note?.id, note?.ackRev, vaultId]);

  if (!note) return <p className="pane-empty">Open a note to see its revisions.</p>;
  if (!synced || !vaultId) return <p className="pane-empty">History appears once this note syncs.</p>;
  if (revisions === null) return <p className="pane-empty">Loading revisions…</p>;

  const restore = async (rev: number) => {
    setAsking(null);
    setStatus(`Restoring r${rev}…`);
    try {
      const made = await restoreRevision(note, vaultId, rev, revisions[0].rev);
      setStatus(`Restored r${rev} as r${made.rev}`);
      load();
    } catch (e) {
      if (e instanceof HttpError && e.code === "revision_conflict") {
        const head = e.body?.error.head_revision;
        if (typeof head === "number") await reloadHead(note, vaultId, head);
        setStatus("This note changed on another device. The latest version is loaded — choose a revision again.");
        load();
      } else if (e instanceof HttpError && e.code === "storage_unavailable") {
        setStatus("Restore paused: storage unavailable. Nothing changed.");
      } else {
        setStatus(e instanceof HttpError ? e.message : "The server can't be reached. Nothing changed.");
      }
    }
  };

  return (
    <div className="history">
      <p className="restore-status" role="status" aria-label="Restore status">{status}</p>
      <ol className="revisions" aria-label="Revisions">
        {revisions.map((r) => (
          <li key={r.rev} className="revision">
            <div className="revision-head">
              <span className="num rev">r{r.rev}</span>
              <span className="revision-device">{r.device_name}</span>
              <time className="num muted" dateTime={r.created_at}>{formatWhen(r.created_at, zone)}</time>
            </div>
            <div className="revision-foot">
              <span className="muted num">{r.base_revision === null ? "first revision" : `based on r${r.base_revision}`}</span>
              {r.restored_from !== null && <span className="restored num">restored from r{r.restored_from}</span>}
              <button type="button" className="button button-quiet" aria-label={`Restore r${r.rev}`} onClick={() => setAsking(r.rev)}>
                <HistoryIcon aria-hidden size={15} strokeWidth={1.5} /> Restore
              </button>
            </div>
          </li>
        ))}
      </ol>
      {asking !== null && (
        <Modal title="Restore revision" onClose={() => setAsking(null)} initialFocus={restoreButton}>
          <p>{`Restore r${asking} as a new revision?`}</p>
          <p className="muted">The note's current text stays in its history; nothing is ever removed.</p>
          <div className="modal-actions">
            <button ref={restoreButton} type="button" className="button" onClick={() => void restore(asking)}>Restore</button>
            <button type="button" className="button" onClick={() => setAsking(null)}>Cancel</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
