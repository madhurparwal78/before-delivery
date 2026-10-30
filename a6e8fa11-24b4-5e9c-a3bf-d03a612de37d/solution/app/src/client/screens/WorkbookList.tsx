import { type FormEvent, useEffect, useRef, useState } from "react";
import { ApiFailure, api, request, uuid } from "../api.js";
import { COPY, SEASON_CHIP, count, importError, importLimitLines, localTime } from "../copy.js";
import { Link, navigate } from "../router.js";
import { useSession } from "../session.js";
import { type Limits, type WorkbookSummary } from "../types.js";
import { Dialog } from "../ui/Dialog.js";
import { FieldError, Icon } from "../ui/Icon.js";
import { notify } from "../ui/notices.js";

function SeasonChip({ state }: { state: WorkbookSummary["state"] }): JSX.Element {
  return <span className={`chip chip-${state}`}>{SEASON_CHIP[state]}</span>;
}

/** Empty states get a small drawing of ploughed furrows. */
function FurrowsDrawing(): JSX.Element {
  return (
    <svg width="64" height="40" viewBox="0 0 64 40" aria-hidden="true" focusable="false" className="furrows">
      {[8, 18, 28].map((y) => (
        <path key={y} d={`M4 ${y}c10-6 18-6 28 0s18 6 28 0`} fill="none" stroke="var(--rule-strong)" strokeWidth="2" strokeLinecap="round" />
      ))}
      <path d="M50 4v14" stroke="var(--rust)" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

function CreateDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const key = useRef(uuid());
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (busy) return;
    if (name.length < 1 || name.length > 80) {
      setError(COPY.workbookName);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const r = await api.post<{ workbook: WorkbookSummary }>("/api/workbooks", { name }, { "Idempotency-Key": key.current });
      notify("Workbook created.");
      navigate(`/w/${r.workbook.id}`);
    } catch (err) {
      setBusy(false);
      setError(err instanceof ApiFailure && err.fields.name ? err.fields.name : "The workbook wasn't created. Check your connection and try again.");
    }
  };
  return (
    <Dialog title="Create workbook" onClose={onClose}>
      <form onSubmit={(e) => void submit(e)} noValidate>
        <label className="field">
          <span>Workbook name</span>
          <input value={name} maxLength={200} onChange={(e) => setName(e.target.value)} aria-describedby="create-error" />
        </label>
        <FieldError id="create-error">{error}</FieldError>
        <div className="dialog-actions">
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function ImportDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const key = useRef(uuid());
  const [limits, setLimits] = useState<Limits | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    api.get<Limits>("/api/limits").then(setLimits).catch(() => undefined);
  }, []);
  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (busy) return;
    if (!file) {
      setError("Choose a .xlsx or .csv workbook file.");
      return;
    }
    if (name.length > 80) {
      setError(COPY.workbookName);
      return;
    }
    setBusy(true);
    setError("");
    const form = new FormData();
    form.append("file", file, file.name);
    if (name) form.append("name", name);
    try {
      const r = await request<{ workbook: WorkbookSummary; sheets: unknown[] }>("POST", "/api/workbooks/import", {
        raw: form,
        headers: { "Idempotency-Key": key.current },
      });
      notify(`Imported ${r.workbook.name} with ${count(r.sheets.length, "sheet")}.`);
      navigate(`/w/${r.workbook.id}`);
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiFailure) setError(err.fields.name ?? err.fields.file ?? importError(err.code, err.status, err.limit));
      else setError("The file didn't reach the server. Check your connection and try again.");
    }
  };
  return (
    <Dialog title="Import workbook" onClose={onClose}>
      <form onSubmit={(e) => void submit(e)} noValidate>
        <ul className="limits" aria-label="Import limits">
          {limits && importLimitLines(limits).map((line) => <li key={line}>{line}</li>)}
        </ul>
        <label className="field">
          <span>Workbook file</span>
          <input type="file" accept=".xlsx,.csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <label className="field">
          <span>Workbook name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Defaults to the file name" />
        </label>
        <FieldError>{error}</FieldError>
        <div className="dialog-actions">
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Importing…" : "Import"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function WorkbookList(): JSX.Element {
  const { user } = useSession();
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<WorkbookSummary[] | null>(null);
  const [shownQuery, setShownQuery] = useState("");
  const [dialog, setDialog] = useState<"create" | "import" | null>(null);
  const editor = user.role === "lead" || user.role === "data_manager";

  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      api
        .get<{ workbooks: WorkbookSummary[] }>(`/api/workbooks?q=${encodeURIComponent(query)}`)
        .then((r) => {
          if (!live) return;
          setRows(r.workbooks);
          setShownQuery(query);
        })
        .catch(() => undefined);
    }, query ? 120 : 0);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query]);

  return (
    <main className="page list-page graph-faint">
      <div className="list-head">
        <h1>Workbooks</h1>
        <div className="list-tools">
          <label className="search">
            <Icon name="search" />
            <input type="search" aria-label="Search workbooks" placeholder="Search by name" value={query} maxLength={100} onChange={(e) => setQuery(e.target.value)} />
          </label>
          {editor && (
            <>
              <button type="button" className="btn btn-primary" onClick={() => setDialog("create")}>
                <Icon name="plus" />
                Create workbook
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setDialog("import")}>
                <Icon name="upload" />
                Import workbook
              </button>
            </>
          )}
        </div>
      </div>
      {rows === null ? (
        <ul className="workbooks skeleton" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <li key={i} />
          ))}
        </ul>
      ) : (
        <ul className="workbooks" aria-label="Workbooks">
          {rows.map((w) => (
            <li key={w.id} className="workbook-row">
              <Link href={`/w/${w.id}`} className="workbook-link">
                {w.name}
              </Link>
              <SeasonChip state={w.state} />
              <span className="when">{w.closesAtUtc ? `Cutoff ${localTime(w.closesAtUtc, user.timeZone)}` : "No cutoff"}</span>
              <span className="when">Updated {localTime(w.updatedAt, user.timeZone)}</span>
            </li>
          ))}
        </ul>
      )}
      {rows !== null && rows.length === 0 && (
        <div className="empty">
          <FurrowsDrawing />
          <p>{shownQuery ? `No workbooks match "${shownQuery}".` : "No workbooks yet."}</p>
        </div>
      )}
      {dialog === "create" && <CreateDialog onClose={() => setDialog(null)} />}
      {dialog === "import" && <ImportDialog onClose={() => setDialog(null)} />}
    </main>
  );
}
