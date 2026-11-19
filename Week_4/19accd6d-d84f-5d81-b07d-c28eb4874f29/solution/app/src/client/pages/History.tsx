import { GitCompare } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RecipeSummary, VersionHeader } from "../../shared/api";
import { briefDate } from "../../shared/dates";
import { api, ApiFailure } from "../api";
import { onLiveCatchUp, onLiveMessage } from "../live";
import { navigate } from "../router";
import { session } from "../session";
import { useStore } from "../store";
import { Modal } from "../ui/Modal";
import { IconButton } from "../ui/Pane";
import { Screen } from "../ui/Screen";
import { pluralize } from "../workbench/InputPane";

function CompareDialog({ recipeId, versions, onClose }: { recipeId: string; versions: VersionHeader[]; onClose: () => void }) {
  const newest = versions[0] as VersionHeader;
  const [from, setFrom] = useState((versions[1] ?? newest).n);
  const [to, setTo] = useState(newest.n);
  const [changes, setChanges] = useState<string[] | null>(null);

  useEffect(() => {
    let current = true;
    void api<{ changes: string[] }>("GET", `/api/recipes/${recipeId}/compare?from=${from}&to=${to}`).then((answer) => {
      if (current) setChanges(answer.changes);
    });
    return () => {
      current = false;
    };
  }, [recipeId, from, to]);

  const picker = (label: string, value: number, onChange: (n: number) => void) => (
    <div className="form-field">
      <label htmlFor={`compare-${label}`}>{label}</label>
      <select id={`compare-${label}`} value={value} onChange={(event) => onChange(Number(event.target.value))}>
        {versions.map((version) => (
          <option key={version.n} value={version.n}>{version.n}</option>
        ))}
      </select>
    </div>
  );

  return (
    <Modal title="Compare versions" onClose={onClose}>
      <div className="compare-pickers">
        {picker("From version", from, setFrom)}
        {picker("To version", to, setTo)}
      </div>
      {changes && changes.length > 0 && (
        <ul role="list" aria-label="Changes" className="changes mono">
          {changes.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      {changes && changes.length === 0 && <p className="modal-note">These versions have the same steps.</p>}
      <div className="modal-actions">
        <button type="button" className="primary" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}

function RestoreDialog({ version, onClose, onRestore }: { version: number; onClose: () => void; onRestore: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Restore version" onClose={onClose}>
      <p className="modal-note">Restore version {version} as a new version?</p>
      <div className="modal-actions">
        <button type="button" onClick={onClose}>Cancel</button>
        <button
          type="button"
          className="primary"
          aria-busy={busy}
          onClick={() => {
            if (busy) return;
            setBusy(true);
            void onRestore().then(onClose);
          }}
        >
          Restore
        </button>
      </div>
    </Modal>
  );
}

export function History({ recipeId }: { recipeId: string }) {
  const user = useStore(session, (state) => state.user);
  const [message, setMessage] = useState("");
  const [detail, setDetail] = useState<{ recipe: RecipeSummary; versions: VersionHeader[] } | null>(null);
  const [missing, setMissing] = useState(false);
  const [dialog, setDialog] = useState<"compare" | { restore: number } | null>(null);
  const compareButton = useRef<HTMLButtonElement>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      setDetail(await api<{ recipe: RecipeSummary; versions: VersionHeader[] }>("GET", `/api/recipes/${recipeId}`));
    } catch (error) {
      if (!(error instanceof ApiFailure) || error.status !== 404) throw error;
      setMissing(true);
    }
  }, [recipeId]);

  useEffect(() => {
    setMessage("");
    if (user) void load();
  }, [user, load]);

  useEffect(() => {
    const offMessage = onLiveMessage((live) => {
      if (live.type === "version_saved" && live.recipeId === recipeId) void load();
    });
    const offCatchUp = onLiveCatchUp(() => void load());
    return () => {
      offMessage();
      offCatchUp();
    };
  }, [recipeId, load]);

  const restore = (version: number) => async (): Promise<void> => {
    const base = (detail as { recipe: RecipeSummary }).recipe.latestVersion;
    try {
      const saved = await api<{ version: { n: number } }>("POST", `/api/recipes/${recipeId}/restore`, { version, baseVersion: base });
      setMessage(`Restored version ${version} as version ${saved.version.n}`);
      await load();
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
      setMessage(error.message);
      await load();
    }
  };

  const versions = detail?.versions ?? [];
  return (
    <Screen
      label="Recipe history"
      title={detail ? detail.recipe.name : missing ? "Recipe not found" : "Recipe history"}
      actions={
        detail && (
          <IconButton ref={compareButton} label="Compare versions" onClick={() => setDialog("compare")}>
            <GitCompare size={22} aria-hidden="true" />
          </IconButton>
        )
      }
      strip={<div role="status" aria-label="Library announcements" aria-live="polite">{message || pluralize(versions.length, "version")}</div>}
    >
      {!user && <p className="empty">Sign in to see this recipe.</p>}
      {missing && <p className="empty">This recipe is not available.</p>}
      <h2 className="section-title">Versions</h2>
      <ul role="list" aria-label="Versions" className="rows">
        {versions.map((version, index) => (
          <li key={version.n} aria-label={`Version ${version.n}`} className="row version-row">
            <div className="version-main">
              <strong>Version {version.n}</strong>
              <span className="row-meta">{version.note || "No note"}</span>
              <span className="row-meta">{version.author.displayName} · {briefDate(version.createdAt)}</span>
            </div>
            <div className="version-actions">
              <button type="button" aria-label={`Open version ${version.n}`} onClick={() => navigate(`/w?recipe=${recipeId}&version=${version.n}`)}>Open</button>
              {index > 0 ? (
                <button type="button" aria-label={`Restore version ${version.n}`} onClick={() => setDialog({ restore: version.n })}>Restore</button>
              ) : (
                <span className="action-gap" aria-hidden="true" />
              )}
            </div>
          </li>
        ))}
      </ul>
      {dialog === "compare" && <CompareDialog recipeId={recipeId} versions={versions} onClose={() => setDialog(null)} />}
      {dialog !== null && dialog !== "compare" && (
        <RestoreDialog version={dialog.restore} onClose={() => setDialog(null)} onRestore={restore(dialog.restore)} />
      )}
    </Screen>
  );
}
