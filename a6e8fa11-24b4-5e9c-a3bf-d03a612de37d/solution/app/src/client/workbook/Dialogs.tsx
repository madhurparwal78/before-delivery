// Workbook dialogs: season cutoff, sheet name, export and share links.
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { type WorkbookEngine } from "../../shared/engine.js";
import { canAddSheet, sheetNameAllowed } from "../../shared/sheets.js";
import { ApiFailure, api } from "../api.js";
import { COPY, SEASON_WORD, localTime } from "../copy.js";
import { type ExportItem, type SeasonState, type ShareLink, type WorkbookSummary } from "../types.js";
import { Dialog } from "../ui/Dialog.js";
import { FieldError, Icon } from "../ui/Icon.js";
import { notify } from "../ui/notices.js";

const CUTOFF_TEXT = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})$/;

export function CutoffDialog({
  workbookId,
  mode,
  current,
  zone,
  state,
  onDone,
  onClose,
}: {
  workbookId: string;
  mode: "cutoff" | "reopen";
  current: string | null;
  zone: string;
  state: SeasonState;
  onDone(w: WorkbookSummary): void;
  onClose(): void;
}): JSX.Element {
  const [text, setText] = useState(current ? current.slice(0, 16).replace("T", " ") : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    const trimmed = text.trim();
    const m = CUTOFF_TEXT.exec(trimmed);
    if (trimmed && !m) {
      setError(COPY.cutoffFormat);
      return;
    }
    const closesAt = m ? `${m[1]}T${m[2]}` : null;
    setBusy(true);
    setError("");
    try {
      const r =
        mode === "reopen"
          ? await api.post<{ workbook: WorkbookSummary }>(`/api/workbooks/${workbookId}/season`, closesAt ? { action: "reopen", closesAt } : { action: "reopen" })
          : await api.patch<{ workbook: WorkbookSummary }>(`/api/workbooks/${workbookId}`, { closesAt });
      if (mode === "reopen") notify("Season reopened.");
      else notify(r.workbook.closesAtUtc ? `Cutoff set to ${localTime(r.workbook.closesAtUtc, zone)}.` : "Cutoff cleared.");
      onDone(r.workbook);
      onClose();
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiFailure && err.fields.closesAt) setError(err.fields.closesAt);
      else if (err instanceof ApiFailure && err.status === 409) setError(`That isn't allowed while the workbook is ${SEASON_WORD[state]}.`);
      else setError("The season wasn't changed. Check your connection and try again.");
    }
  };
  return (
    <Dialog title="Season cutoff" onClose={onClose}>
      <form onSubmit={(e) => void submit(e)} noValidate>
        <label className="field">
          <span>Cutoff (station time)</span>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="2026-10-30 17:00" className="mono" aria-describedby="cutoff-hint" />
        </label>
        <p className="hint" id="cutoff-hint">
          YYYY-MM-DD HH:MM, 24-hour, in {zone}. {mode === "reopen" ? "Leave empty to reopen with no cutoff." : "Leave empty to clear the cutoff."}
        </p>
        <FieldError>{error}</FieldError>
        <div className="dialog-actions">
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Saving…" : mode === "reopen" ? "Reopen" : "Save cutoff"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function SheetNameDialog({
  engine,
  renaming,
  onSave,
  onClose,
}: {
  engine: WorkbookEngine;
  renaming: string | null;
  onSave(name: string): void;
  onClose(): void;
}): JSX.Element {
  const [name, setName] = useState(renaming ? (engine.sheetById(renaming)?.name ?? "") : "");
  const [error, setError] = useState("");
  const submit = (e: FormEvent): void => {
    e.preventDefault();
    if (!sheetNameAllowed(engine, name, renaming) || (!renaming && !canAddSheet(engine))) {
      setError(COPY.sheetName);
      return;
    }
    onSave(name);
    onClose();
  };
  return (
    <Dialog title="Sheet name" onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <label className="field">
          <span>Sheet name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <FieldError>{error}</FieldError>
        <div className="dialog-actions">
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary">
            Save sheet name
          </button>
        </div>
      </form>
    </Dialog>
  );
}

const EXPORT_STATUS: Record<ExportItem["status"], string> = { pending: "Pending", waiting_for_storage: "Waiting for file storage", ready: "Ready" };

export function ExportDialog({ workbookId, sheetId, onClose }: { workbookId: string; sheetId: string; onClose(): void }): JSX.Element {
  const [format, setFormat] = useState<"xlsx" | "csv">("xlsx");
  const [busy, setBusy] = useState(false);
  const [exports, setExports] = useState<ExportItem[]>([]);
  const load = useCallback(() => {
    api
      .get<{ exports: ExportItem[] }>(`/api/workbooks/${workbookId}/exports`)
      .then((r) => setExports(r.exports))
      .catch(() => undefined);
  }, [workbookId]);
  useEffect(() => {
    load();
    const timer = setInterval(load, 2000);
    return () => clearInterval(timer);
  }, [load]);
  const start = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await api.post(`/api/workbooks/${workbookId}/exports`, format === "xlsx" ? { format } : { format, sheetId });
      notify(COPY.exportQueued);
      load();
    } catch {
      notify("The export wasn't started. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog title="Export workbook" onClose={onClose}>
      <div role="radiogroup" aria-label="Export format" className="radios radios-stacked">
        <label className="radio">
          <input type="radio" name="export-format" checked={format === "xlsx"} onChange={() => setFormat("xlsx")} />
          <span>Excel workbook (.xlsx)</span>
        </label>
        <label className="radio">
          <input type="radio" name="export-format" checked={format === "csv"} onChange={() => setFormat("csv")} />
          <span>CSV of current sheet (.csv)</span>
        </label>
      </div>
      <div className="dialog-actions">
        <button type="button" className="btn btn-quiet" onClick={onClose}>
          Close
        </button>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void start()}>
          {busy ? "Starting…" : "Start export"}
        </button>
      </div>
      <h3 className="dialog-sub">Recent exports</h3>
      <ul className="exports" aria-label="Recent exports">
        {exports.map((e) => (
          <li key={e.id}>
            <span className="file-name">{e.fileName}</span>
            <span className={`export-status status-${e.status}`}>{EXPORT_STATUS[e.status]}</span>
            {e.status === "ready" && (
              <a className="btn btn-secondary" href={`/api/exports/${e.id}/download`} download={e.fileName} aria-label={`Download ${e.fileName}`}>
                <Icon name="download" />
                Download
              </a>
            )}
          </li>
        ))}
        {exports.length === 0 && <li className="muted">No exports yet.</li>}
      </ul>
    </Dialog>
  );
}

const LIFETIMES = [
  { label: "1 day", seconds: 86_400 },
  { label: "7 days", seconds: 604_800 },
  { label: "30 days", seconds: 2_592_000 },
];

export function ShareDialog({ workbookId, zone, onClose }: { workbookId: string; zone: string; onClose(): void }): JSX.Element {
  const [seconds, setSeconds] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [latest, setLatest] = useState("");
  const load = useCallback(() => {
    api
      .get<{ links: ShareLink[] }>(`/api/workbooks/${workbookId}/share-links`)
      .then((r) => setLinks(r.links))
      .catch(() => undefined);
  }, [workbookId]);
  useEffect(load, [load]);
  const full = (url: string): string => `${location.origin}${url}`;

  const create = async (): Promise<void> => {
    if (!seconds) {
      setError(COPY.linkLength);
      return;
    }
    setBusy("create");
    setError("");
    try {
      const r = await api.post<{ link: ShareLink }>(`/api/workbooks/${workbookId}/share-links`, { expiresInSeconds: Number(seconds) });
      setLatest(full(r.link.url));
      notify(`Link created. It expires ${localTime(r.link.expiresAt, zone)}.`);
      load();
    } catch (err) {
      setError(err instanceof ApiFailure && err.fields.expiresInSeconds ? COPY.linkLength : "The link wasn't created. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const regenerate = async (link: ShareLink): Promise<void> => {
    setBusy(link.id);
    try {
      const r = await api.post<{ link: ShareLink }>(`/api/workbooks/${workbookId}/share-links/${link.id}/regenerate`);
      setLatest(full(r.link.url));
      notify("New link created. The old link no longer works.");
    } catch {
      notify("That link no longer works, so it can't be regenerated.");
    } finally {
      setBusy(null);
      load();
    }
  };

  const revoke = async (link: ShareLink): Promise<void> => {
    setBusy(link.id);
    try {
      await api.del(`/api/workbooks/${workbookId}/share-links/${link.id}`);
      if (latest === full(link.url)) setLatest("");
      notify("Link revoked.");
    } catch {
      notify("The link wasn't revoked. Try again.");
    } finally {
      setBusy(null);
      load();
    }
  };

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(latest);
    } catch {
      const field = document.getElementById("share-link-field") as HTMLInputElement;
      field.select();
      document.execCommand("copy");
    }
    notify("Link copied.");
  };

  const active = links.filter((l) => l.status === "active");
  return (
    <Dialog title="Share read-only link" onClose={onClose}>
      <div className="share-create">
        <label className="field">
          <span>Expires in</span>
          <select value={seconds} onChange={(e) => setSeconds(e.target.value)}>
            <option value="">Choose how long</option>
            {LIFETIMES.map((l) => (
              <option key={l.seconds} value={String(l.seconds)}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn btn-primary" disabled={busy === "create"} onClick={() => void create()}>
          {busy === "create" ? "Saving…" : "Create link"}
        </button>
      </div>
      <FieldError>{error}</FieldError>
      <div className="share-field">
        <label className="field">
          <span>Share link</span>
          <input id="share-link-field" readOnly value={latest} className="mono" placeholder="Create a link to share it" />
        </label>
        <button type="button" className="btn btn-secondary" disabled={!latest} onClick={() => void copy()}>
          <Icon name="copy" />
          Copy link
        </button>
      </div>
      <h3 className="dialog-sub">Active links</h3>
      <ul className="share-links" aria-label="Share links">
        {active.map((l) => (
          <li key={l.id}>
            <span className="mono link-url">{l.url}</span>
            <span className="muted">Expires {localTime(l.expiresAt, zone)}</span>
            <span className="link-actions">
              <button type="button" className="btn btn-secondary" disabled={busy === l.id} onClick={() => void regenerate(l)}>
                Regenerate link
              </button>
              <button type="button" className="btn btn-quiet" disabled={busy === l.id} onClick={() => void revoke(l)}>
                Revoke link
              </button>
            </span>
          </li>
        ))}
        {active.length === 0 && <li className="muted">No active links.</li>}
      </ul>
    </Dialog>
  );
}
