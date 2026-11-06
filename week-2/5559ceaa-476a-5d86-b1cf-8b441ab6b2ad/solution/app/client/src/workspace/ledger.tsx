import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { api, newKey, Refusal, UNEXPECTED } from "../api";
import { Dialog } from "../dialog";
import { ledgerTime, stamp } from "../format";
import { Icon } from "../icons";
import { reducedMotion } from "../motion";
import { EMAIL_ERROR, validEmail } from "../pages/auth";
import type { Checkpoint, CheckpointFile, FileMeta, ReviewerLink } from "../types";

const STATE_LABEL: Record<Checkpoint["state"], string> = { pending_upload: "Pending upload", saved: "Saved", failed: "Failed" };
const NOT_SAVED = "This checkpoint hasn't finished uploading yet.";
const REFRESH_MS = 30_000;

const checkpointCopy = (checkpoint: Checkpoint): string =>
  checkpoint.state === "saved"
    ? `Checkpoint "${checkpoint.name}" saved.`
    : checkpoint.state === "failed"
      ? `Checkpoint "${checkpoint.name}" couldn't be uploaded. Save it again.`
      : `Checkpoint "${checkpoint.name}" is pending upload. Keep working — storage is unreachable right now.`;

function Row({ checkpoint, fresh, children }: { checkpoint: Checkpoint; fresh: boolean; children: React.ReactNode }) {
  const ref = useRef<HTMLLIElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  const previous = useRef(checkpoint.state);
  useEffect(() => {
    if (fresh && ref.current && !reducedMotion()) {
      ref.current.animate([{ opacity: 0, transform: "translateY(-6px)" }, { opacity: 1, transform: "none" }], { duration: 200, easing: "ease-out" });
    }
  }, [fresh]);
  useEffect(() => {
    if (previous.current !== checkpoint.state && label.current && !reducedMotion()) {
      label.current.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160 });
    }
    previous.current = checkpoint.state;
  }, [checkpoint.state]);
  return (
    <li ref={ref} className="ledger-row">
      <div className="ledger-main">
        <span className="ledger-name">{checkpoint.name}</span>{" "}
        <span ref={label} className={`state state-${checkpoint.state}`}>
          {STATE_LABEL[checkpoint.state]}
        </span>
      </div>
      <div className="ledger-meta">
        {" "}
        <span>{checkpoint.created_by.name}</span>
        <span aria-hidden="true"> · </span>
        <time className="num" dateTime={checkpoint.created_at}>
          {ledgerTime(checkpoint.created_at)}
        </time>
        <span aria-hidden="true"> · </span>
        <span className="num">
          {checkpoint.file_count} {checkpoint.file_count === 1 ? "file" : "files"}
        </span>{" "}
      </div>
      <div className="ledger-actions">{children}</div>
    </li>
  );
}

function CheckpointDialog({ checkpoint, files, onClose }: { checkpoint: Checkpoint | null; files: Map<string, FileMeta>; onClose: () => void }) {
  const [rows, setRows] = useState<CheckpointFile[] | null>(null);
  const last = useRef<Checkpoint | null>(null);
  if (checkpoint) last.current = checkpoint;
  const [error, setError] = useState("");
  useEffect(() => {
    if (!checkpoint) return;
    setRows(null);
    setError("");
    api<{ checkpoint: { files: CheckpointFile[] } }>(`/api/checkpoints/${checkpoint.id}`)
      .then((r) => setRows(r.checkpoint.files))
      .catch(() => setError(UNEXPECTED));
  }, [checkpoint?.id]);
  return (
    <Dialog open={checkpoint !== null} onClose={onClose} title={`Checkpoint ${last.current?.name ?? ""}`}>
      <div className="dialog-body">
        {checkpoint && (
          <p className="dialog-copy">
            Saved by {checkpoint.created_by.name} at <span className="num">{stamp(checkpoint.created_at)}</span> ·{" "}
            {STATE_LABEL[checkpoint.state]}
          </p>
        )}
        {error && <p className="field-error">{error}</p>}
        {rows === null && !error && <p className="dialog-copy">Loading files…</p>}
        {rows && (
          <ul className="path-list" aria-label="Checkpoint files">
            {rows.map((row) => {
              const current = files.get(row.file_id)?.path ?? null;
              return (
                <li key={row.file_id}>
                  <span className="mono">{row.path}</span>
                  {current === null ? (
                    <span className="path-note path-gone">deleted since</span>
                  ) : current !== row.path ? (
                    <span className="path-note">
                      now <span className="mono">{current}</span>
                    </span>
                  ) : null}
                  <span className="num path-size">{row.size} B</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Dialog>
  );
}

function ShareDialog({ checkpoint, onClose }: { checkpoint: Checkpoint | null; onClose: () => void }) {
  const [hours, setHours] = useState("48");
  const [email, setEmail] = useState("");
  const [url, setUrl] = useState("");
  const [links, setLinks] = useState<ReviewerLink[]>([]);
  const [status, setStatus] = useState<{ text: string; chip?: string }>({ text: "" });
  const [busy, setBusy] = useState(false);
  const open = checkpoint !== null;
  const id = checkpoint?.id;

  useEffect(() => {
    if (!id) return;
    setUrl("");
    setStatus({ text: "" });
    const refresh = () =>
      api<{ links: ReviewerLink[] }>(`/api/checkpoints/${id}/reviewer-links`)
        .then((r) => setLinks(r.links))
        .catch(() => undefined);
    void refresh();
    const timer = window.setInterval(refresh, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [id]);

  const create = async () => {
    if (!checkpoint) return;
    const value = Number(hours);
    if (!Number.isInteger(value) || value < 1 || value > 336) return setStatus({ text: "Choose between 1 and 336 hours." });
    if (email.trim() && !validEmail(email)) return setStatus({ text: EMAIL_ERROR });
    setBusy(true);
    try {
      const body: Record<string, unknown> = { expires_in_hours: value };
      if (email.trim()) body.email = email.trim();
      const r = await api<{ link: ReviewerLink }>(`/api/checkpoints/${checkpoint.id}/reviewer-links`, {
        method: "POST",
        body,
        headers: { "Idempotency-Key": newKey() },
      });
      setUrl(r.link.url);
      setLinks((list) => [r.link, ...list.filter((l) => l.id !== r.link.id)]);
      setStatus({
        text: `Reviewer link created. It expires ${stamp(r.link.expires_at)}.`,
        chip: r.link.email_status === "sent" ? "Email sent" : r.link.email_status === "queued" ? "Email queued" : undefined,
      });
    } catch (error) {
      const code = error instanceof Refusal ? error.code : "";
      const fields = error instanceof Refusal ? (error.body.fields as Record<string, string> | undefined) : undefined;
      setStatus({
        text:
          code === "checkpoint_not_saved"
            ? NOT_SAVED
            : code === "validation" && fields?.email
              ? EMAIL_ERROR
              : code === "validation"
                ? "Choose between 1 and 336 hours."
                : UNEXPECTED,
      });
    } finally {
      setBusy(false);
    }
  };

  const act = async (link: ReviewerLink, action: "revoke" | "regenerate") => {
    try {
      const r = await api<{ link: ReviewerLink }>(`/api/reviewer-links/${link.id}/${action}`, { method: "POST" });
      setLinks((list) => list.map((l) => (l.id === link.id ? r.link : l)));
      if (action === "regenerate") setUrl(r.link.url);
      setStatus({ text: action === "revoke" ? "Link revoked. It no longer opens." : "New link created. The old link no longer opens." });
    } catch {
      setStatus({ text: UNEXPECTED });
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setStatus({ text: "Link copied." });
    } catch {
      const field = document.getElementById("reviewer-link") as HTMLInputElement | null;
      field?.select();
      setStatus({ text: "Select the link and copy it." });
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="Share with a reviewer" wide>
      <form
        className="dialog-body"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <p className="dialog-copy">
          A read-only copy of <strong>{checkpoint?.name}</strong> for a parent or peer. They see its name, files and expiry,
          nothing else.
        </p>
        <div className="field-row">
          <label className="field field-narrow">
            <span>Expires in hours</span>
            <input type="number" min={1} max={336} step={1} value={hours} onChange={(e) => setHours(e.target.value)} />
          </label>
          <label className="field">
            <span>Reviewer email (optional)</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
          </label>
        </div>
        <div className="dialog-actions dialog-actions-start">
          <button type="submit" className="button button-primary" disabled={busy}>
            {busy && <span className="spinner" aria-hidden="true" />}
            Create link
          </button>
        </div>
        <div className="field-row">
          <label className="field">
            <span>Reviewer link</span>
            <input id="reviewer-link" className="mono" readOnly value={url} />
          </label>
          <button type="button" className="button field-button" disabled={!url} onClick={() => void copy()}>
            <Icon name="copy" />
            Copy link
          </button>
        </div>
        <p role="status" aria-label="Share status" className="region">
          {status.text}
          {status.chip && <span className="chip">{status.chip}</span>}
        </p>
        <h3 className="list-title">Links for this checkpoint</h3>
        <ul aria-label="Reviewer links" className="link-list">
          {links.length === 0 && <li className="link-empty">No links yet.</li>}
          {links.map((link) => (
            <li key={link.id} className="link-row">
              <span className={`state state-link-${link.state}`}>{link.state === "active" ? "Active" : link.state === "expired" ? "Expired" : "Revoked"}</span>
              <span className="num link-expiry">until {stamp(link.expires_at)}</span>
              {link.state === "active" && (
                <span className="link-actions">
                  <button type="button" className="button button-quiet" onClick={() => void act(link, "regenerate")}>
                    Regenerate
                  </button>
                  <button type="button" className="button button-quiet button-danger-text" onClick={() => void act(link, "revoke")}>
                    Revoke
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      </form>
    </Dialog>
  );
}

export interface LedgerHandle {
  announce: (checkpoint: Checkpoint) => void;
  /** A file change pushed by the server; any change not made by the latest restore ends "Undo restore". */
  fileEvent: (file: FileMeta | null, deletedId?: string) => void;
}

interface LedgerProps {
  checkpoints: Checkpoint[];
  files: Map<string, FileMeta>;
  projectId: string;
  isMentor: boolean;
  canWrite: boolean;
  onRestored: (files: FileMeta[]) => void;
}

export const Ledger = forwardRef<LedgerHandle, LedgerProps>(function Ledger({ checkpoints, files, projectId, isMentor, canWrite, onRestored }, handle) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [checkpointStatus, setCheckpointStatus] = useState("");
  const [restoreStatus, setRestoreStatus] = useState("");
  const [undoable, setUndoable] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [opened, setOpened] = useState<Checkpoint | null>(null);
  const [sharing, setSharing] = useState<Checkpoint | null>(null);
  const seen = useRef(new Set(checkpoints.map((c) => c.id)));
  const [fresh, setFresh] = useState<string | null>(null);

  const restored = useRef<{ pending: boolean; files: Map<string, FileMeta> }>({ pending: false, files: new Map() });

  useImperativeHandle(handle, () => ({
    announce: (checkpoint) => setCheckpointStatus(checkpointCopy(checkpoint)),
    fileEvent: (file, deletedId) => {
      const guard = restored.current;
      if (guard.pending) return;
      const own = file
        ? guard.files.get(file.id)?.revision === file.revision && guard.files.get(file.id)?.path === file.path
        : deletedId !== undefined && !guard.files.has(deletedId);
      if (!own) setUndoable(null);
    },
  }));

  useEffect(() => {
    for (const c of checkpoints) {
      if (!seen.current.has(c.id)) {
        seen.current.add(c.id);
        setFresh(c.id);
      }
    }
  }, [checkpoints]);

  const save = async () => {
    const trimmed = name.trim();
    if (trimmed.length < 1 || [...trimmed].length > 80) return setCheckpointStatus("Give the checkpoint a name of 1 to 80 characters.");
    setSaving(true);
    setCheckpointStatus("Saving checkpoint…");
    try {
      const r = await api<{ checkpoint: Checkpoint }>(`/api/projects/${projectId}/checkpoints`, { method: "POST", body: { name: trimmed } });
      setCheckpointStatus(checkpointCopy(r.checkpoint));
      setName("");
    } catch (error) {
      setCheckpointStatus(error instanceof Refusal && error.code === "validation" ? "Give the checkpoint a name of 1 to 80 characters." : UNEXPECTED);
    } finally {
      setSaving(false);
    }
  };

  const restore = async (checkpoint: Checkpoint) => {
    setBusy(true);
    setUndoable(null);
    restored.current = { pending: true, files: new Map() };
    setRestoreStatus(`Restoring "${checkpoint.name}"…`);
    try {
      const r = await api<{ restore: { id: string }; files: FileMeta[] }>(`/api/checkpoints/${checkpoint.id}/restore`, { method: "POST" });
      restored.current = { pending: false, files: new Map(r.files.map((f) => [f.id, f])) };
      onRestored(r.files);
      setRestoreStatus(`Restored "${checkpoint.name}".`);
      setUndoable(r.restore.id);
    } catch (error) {
      const code = error instanceof Refusal ? error.code : "";
      setRestoreStatus(
        code === "checkpoint_not_saved"
          ? NOT_SAVED
          : code === "checkpoint_damaged"
            ? "This checkpoint's stored files don't match its record, so it can't be restored."
            : code === "storage_unavailable"
              ? "Storage is unreachable, so checkpoints can't be opened or restored right now."
              : UNEXPECTED,
      );
    } finally {
      restored.current.pending = false;
      setBusy(false);
    }
  };

  const undo = async () => {
    if (!undoable) return;
    setBusy(true);
    setRestoreStatus("Undoing restore…");
    try {
      const r = await api<{ files: FileMeta[] }>(`/api/restores/${undoable}/undo`, { method: "POST" });
      onRestored(r.files);
      setRestoreStatus("Restore undone.");
    } catch (error) {
      const code = error instanceof Refusal ? error.code : "";
      setRestoreStatus(code === "restore_superseded" ? "This restore can't be undone because files changed after it." : UNEXPECTED);
    } finally {
      setUndoable(null);
      setBusy(false);
    }
  };

  return (
    <>
      <form
        className="ledger-save"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label className="field">
          <span>Checkpoint name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="e.g. After loops" />
        </label>
        <button type="submit" className="button button-primary" disabled={saving}>
          {saving ? <span className="spinner" aria-hidden="true" /> : <Icon name="bookmark" />}
          Save checkpoint
        </button>
      </form>
      <div className="ledger-regions">
        <p role="status" aria-label="Checkpoint status" className="region">
          {checkpointStatus}
        </p>
        <div role="status" aria-label="Restore status" className="region">
          {restoreStatus}
          {undoable && (
            <button type="button" className="button button-quiet undo-button" disabled={busy} onClick={() => void undo()}>
              <Icon name="restore" />
              Undo restore
            </button>
          )}
        </div>
      </div>
      {checkpoints.length === 0 ? (
        <p className="empty-title ledger-empty">No checkpoints yet</p>
      ) : (
        <ul aria-label="Checkpoints" className="ledger-list">
          {checkpoints.map((c) => (
            <Row key={c.id} checkpoint={c} fresh={fresh === c.id}>
              <button type="button" className="row-button" aria-label={`Open ${c.name}`} onClick={() => setOpened(c)}>
                <Icon name="eye" />
                <span>Open</span>
              </button>
              <button
                type="button"
                className="row-button"
                aria-label={`Restore ${c.name}`}
                disabled={busy || !canWrite}
                onClick={() => void restore(c)}
              >
                <Icon name="restore" />
                <span>Restore</span>
              </button>
              {isMentor && (
                <button type="button" className="row-button" aria-label={`Share ${c.name}`} onClick={() => setSharing(c)}>
                  <Icon name="share" />
                  <span>Share</span>
                </button>
              )}
            </Row>
          ))}
        </ul>
      )}
      <CheckpointDialog checkpoint={opened} files={files} onClose={() => setOpened(null)} />
      {isMentor && <ShareDialog checkpoint={sharing} onClose={() => setSharing(null)} />}
    </>
  );
});
