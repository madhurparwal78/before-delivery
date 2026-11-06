import { useEffect, useRef, useState } from "react";
import type { Session, User } from "../../shared/types";
import type { CheckpointRow, FileWithContent } from "./state";
import { api, ApiCallError } from "../lib/api";
import { formatTime } from "../lib/hooks";
import { CheckpointDialog, ShareDialog } from "../components/checkpoint-dialogs";

export function LedgerPanel(props: {
  projectId: string;
  user: User;
  checkpoints: CheckpointRow[];
  setCheckpoints: React.Dispatch<React.SetStateAction<CheckpointRow[]>>;
  files: FileWithContent[];
  band: "narrow" | "medium" | "wide";
  ledgerOpen: boolean;
  setLedgerOpen: (open: boolean) => void;
  isMentor: boolean;
  session: Session | null;
  setActiveFileId: (id: string | null) => void;
  setOpenTabs: (ids: string[] | ((prev: string[]) => string[])) => void;
  setSelectedTreePath: (p: string | null) => void;
  loadFiles: () => Promise<FileWithContent[]>;
}): React.ReactElement {
  const {
    projectId, checkpoints, setCheckpoints, files, band,
    ledgerOpen, setLedgerOpen, isMentor, session,
    setActiveFileId, setOpenTabs, setSelectedTreePath, loadFiles,
  } = props;
  const [name, setName] = useState("");
  const [cpStatus, setCpStatus] = useState("");
  const [restoreStatus, setRestoreStatus] = useState<{ text: string; undo?: boolean; restoreId?: string }>({ text: "" });
  const [openDialog, setOpenDialog] = useState<CheckpointRow | null>(null);
  const [shareTarget, setShareTarget] = useState<CheckpointRow | null>(null);
  const [pendingSave, setPendingSave] = useState(false);
  const saveBtnRef = useRef<HTMLButtonElement | null>(null);
  // The name of a checkpoint this viewer saved, announced as its state changes in place.
  const savedByName = useRef<string | null>(null);

  const save = async () => {
    if (pendingSave) return;
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > 80) {
      setCpStatus("Give the checkpoint a name of 1 to 80 characters.");
      return;
    }
    setPendingSave(true);
    setCpStatus("Saving checkpoint…");
    try {
      const res = await api<{ checkpoint: CheckpointRow }>(
        "POST",
        `/api/projects/${projectId}/checkpoints`,
        { name: trimmed },
      );
      const cp = res.data?.checkpoint;
      if (cp) {
        setCheckpoints((prev) => [cp, ...prev.filter((c) => c.id !== cp.id)]);
        if (res.status === 202) {
          savedByName.current = cp.name;
          setCpStatus(`Checkpoint "${cp.name}" is pending upload. Keep working — storage is unreachable right now.`);
        } else {
          setCpStatus(`Checkpoint "${cp.name}" saved.`);
        }
      }
      setName("");
    } catch (err) {
      if (err instanceof ApiCallError && err.code === "validation") {
        setCpStatus("Give the checkpoint a name of 1 to 80 characters.");
      } else {
        setCpStatus("Something went wrong. Try again.");
      }
    } finally {
      setPendingSave(false);
    }
  };

  // A pending checkpoint turning saved or failed updates the saver's status region.
  useEffect(() => {
    const watching = savedByName.current;
    if (!watching) return;
    const cp = checkpoints.find((c) => c.name === watching);
    if (!cp) return;
    if (cp.state === "saved") {
      setCpStatus(`Checkpoint "${cp.name}" saved.`);
      savedByName.current = null;
    } else if (cp.state === "failed") {
      setCpStatus(`Checkpoint "${cp.name}" couldn't be uploaded. Save it again.`);
      savedByName.current = null;
    }
  }, [checkpoints]);

  const restore = async (cp: CheckpointRow) => {
    if (cp.state !== "saved") {
      setRestoreStatus({ text: "This checkpoint hasn't finished uploading yet." });
      return;
    }
    setRestoreStatus({ text: `Restoring "${cp.name}"…` });
    try {
      const res = await api<{ restore: { id: string }; files: FileWithContent[] }>(
        "POST",
        `/api/checkpoints/${cp.id}/restore`,
      );
      if (res.data) {
        setRestoreStatus({
          text: `Restored "${cp.name}".`,
          undo: true,
          restoreId: res.data.restore.id,
        });
        await loadFiles();
        const first = res.data.files.find((f) => f.path === "src/tip.js") ?? res.data.files[0];
        if (first) {
          setActiveFileId(first.id);
          setOpenTabs((prev) => (prev.includes(first.id) ? prev : [...prev, first.id]));
          setSelectedTreePath(first.path);
        }
      }
    } catch (err) {
      if (err instanceof ApiCallError) {
        if (err.code === "checkpoint_not_saved") {
          setRestoreStatus({ text: "This checkpoint hasn't finished uploading yet." });
        } else if (err.code === "checkpoint_damaged") {
          setRestoreStatus({ text: "This checkpoint's stored files don't match its record, so it can't be restored." });
        } else if (err.code === "storage_unavailable") {
          setRestoreStatus({ text: "Storage is unreachable, so checkpoints can't be opened or restored right now." });
        } else if (err.code === "not_driver" || err.code === "session_paused") {
          setRestoreStatus({ text: "You are viewing — you may not change files right now." });
        } else {
          setRestoreStatus({ text: "Something went wrong. Try again." });
        }
      } else {
        setRestoreStatus({ text: "Something went wrong. Try again." });
      }
    }
  };

  const undo = async () => {
    const id = restoreStatus.restoreId;
    if (!id) return;
    setRestoreStatus({ text: "Undoing restore…" });
    try {
      await api(`POST`, `/api/restores/${id}/undo`);
      setRestoreStatus({ text: "Restore undone." });
      await loadFiles();
    } catch (err) {
      if (err instanceof ApiCallError) {
        if (err.code === "restore_superseded") {
          setRestoreStatus({ text: "This restore can't be undone because files changed after it." });
        } else if (err.code === "restore_already_undone") {
          setRestoreStatus({ text: "This restore can't be undone because files changed after it." });
        } else {
          setRestoreStatus({ text: "Something went wrong. Try again." });
        }
      } else {
        setRestoreStatus({ text: "Something went wrong. Try again." });
      }
    }
  };

  const openCheckpointDialog = async (cp: CheckpointRow) => {
    try {
      const res = await api<{ checkpoint: CheckpointRow }>("GET", `/api/checkpoints/${cp.id}`);
      setOpenDialog({ ...cp, files: res.data?.checkpoint.files ?? [] });
    } catch (err) {
      if (err instanceof ApiCallError) {
        if (err.code === "checkpoint_not_saved") {
          setOpenDialog({ ...cp, files: [] });
        } else if (err.code === "storage_unavailable") {
          setOpenDialog({ ...cp, files: [] });
        } else {
          setOpenDialog({ ...cp, files: [] });
        }
      }
    }
  };

  const bandClass = band === "wide" ? "" : band === "medium" ? " drawer" : " sheet";

  return (
    <>
      <button
        ref={saveBtnRef}
        className="ledger-toggle"
        aria-expanded={ledgerOpen}
        onClick={() => setLedgerOpen(!ledgerOpen)}
      >
        Ledger
      </button>
      {ledgerOpen ? (
        <aside className={`checkpoint-ledger${bandClass}`} aria-label="Checkpoint ledger">
          <div className="ledger-form">
            <input
              aria-label="Checkpoint name"
              placeholder="Checkpoint name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void save();
              }}
            />
            <button onClick={() => void save()} disabled={pendingSave}>
              Save checkpoint
            </button>
          </div>
          <p className="status" role="status" aria-label="Checkpoint status">
            {cpStatus}
          </p>
          <p className="status" role="status" aria-label="Restore status">
            {restoreStatus.text}{" "}
            {restoreStatus.undo ? (
              <button onClick={() => void undo()}>Undo restore</button>
            ) : null}
          </p>
          <ul className="checkpoint-list" aria-label="Checkpoints">
            {checkpoints.map((cp) => (
              <li key={cp.id} className="checkpoint-row">
                <span className="cp-name">{cp.name}</span>
                <span className="cp-author">{cp.created_by.name}</span>
                <span className="cp-time mono">{formatTime(cp.created_at)}</span>
                <span className="cp-count mono">{cp.file_count}</span>
                <span className={`cp-state mono state-${cp.state}`}>
                  {cp.state === "saved" ? "Saved" : cp.state === "pending_upload" ? "Pending upload" : "Failed"}
                </span>
                <span className="cp-actions">
                  <button onClick={() => void openCheckpointDialog(cp)}>Open</button>
                  <button
                    onClick={() => void restore(cp)}
                    aria-label={`Restore ${cp.name}`}
                    disabled={session?.state === "paused"}
                  >
                    Restore
                  </button>
                  {isMentor ? (
                    <button onClick={() => setShareTarget(cp)} aria-label={`Share ${cp.name}`}>
                      Share
                    </button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </aside>
      ) : null}
      {openDialog ? (
        <CheckpointDialog
          checkpoint={openDialog}
          files={files}
          onClose={() => setOpenDialog(null)}
        />
      ) : null}
      {shareTarget && isMentor ? (
        <ShareDialog
          checkpoint={shareTarget}
          onClose={() => setShareTarget(null)}
        />
      ) : null}
    </>
  );
}
