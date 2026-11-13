import { useEffect, useRef, useState } from "react";
import type { LimitsConfig, Role, User } from "../../shared/types.ts";
import { api, formatModified, redirectTo } from "../api.ts";
import { Dialog, WorkspaceHeader } from "../ui.tsx";

type NotebookCard = { id: string; title: string; role: Role; owner_display_name: string; modified_at: string };

export function FileBrowser({ user }: { user: User }) {
  const [notebooks, setNotebooks] = useState<NotebookCard[] | null>(null);
  const [searchResults, setSearchResults] = useState<NotebookCard[] | null>(null);
  const [searchStatus, setSearchStatus] = useState<string>("");
  const [searchOutage, setSearchOutage] = useState(false);
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<"new" | "import" | null>(null);
  const [importErrors, setImportErrors] = useState<string[] | null>(null);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void api.notebooks().then((result) => {
      if (result.ok) setNotebooks(result.value.notebooks);
      else if (result.status === 401) redirectTo("/signin");
    });
  }, []);

  useEffect(() => {
    if (query.trim() === "") {
      setSearchResults(null);
      setSearchOutage(false);
      setSearchStatus("");
      return;
    }
    const handle = setTimeout(async () => {
      const result = await api.search(query.trim());
      if (result.ok) {
        const found = result.value.results;
        const known = new Map((notebooks ?? []).map((nb) => [nb.id, nb]));
        const merged: NotebookCard[] = [];
        for (const hit of found) {
          const card = known.get(hit.id);
          if (card !== undefined) {
            merged.push(card);
            continue;
          }
          const detail = await api.notebook(hit.id);
          if (detail.ok) {
            const nb = detail.value.notebook;
            merged.push({
              id: nb.id,
              title: nb.title,
              role: nb.role,
              owner_display_name: nb.owner_display_name,
              modified_at: new Date().toISOString(),
            });
          }
        }
        setSearchResults(merged);
        setSearchOutage(false);
        setSearchStatus(merged.length === 1 ? "1 notebook found" : `${merged.length} notebooks found`);
      } else if (result.error.error === "search_unavailable") {
        setSearchOutage(true);
        setSearchResults(null);
      }
    }, 500);
    return () => clearTimeout(handle);
  }, [query, notebooks]);

  const list = searchResults ?? notebooks ?? [];

  return (
    <>
      <WorkspaceHeader user={user} />
      <main className="band">
        <div className="container">
          <div className="browser__head">
            <h1 className="section-heading" style={{ textAlign: "left", margin: 0 }}>Your notebooks</h1>
            <div className="browser__tools">
              <div className="search-wrap">
                <label className="field" htmlFor="search-box" style={{ display: "block", width: "100%" }}>
                  <input
                    id="search-box"
                    className="search-input"
                    type="search"
                    role="searchbox"
                    placeholder="Search titles, cells and headings"
                    aria-label="Search notebooks"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </label>
              </div>
              <button className="button--plain" onClick={() => setDialog("new")}>New notebook</button>
              <button className="button--plain" onClick={() => setDialog("import")}>Import notebook</button>
            </div>
          </div>
          <div role="status" aria-live="polite" className="status" id="search-status">
            {searchOutage ? "Search is unavailable" : searchStatus}
          </div>
          {searchOutage ? (
            <div className="alert" role="status" aria-label="Search status">
              <p className="alert__title" style={{ marginBottom: 0 }}>Search is unavailable</p>
            </div>
          ) : query.trim() !== "" && searchResults !== null && searchResults.length === 0 ? (
            <div className="alert" role="status">
              <p className="alert__title" style={{ marginBottom: 0 }}>No notebooks match “{query.trim()}”.</p>
            </div>
          ) : null}
          {notebooks === null ? (
            <p>Loading…</p>
          ) : list.length === 0 && query.trim() === "" ? (
            <div className="empty-state">
              <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
                <rect x="10" y="6" width="24" height="32" rx="2" />
                <path d="M16 14h12M16 20h12M16 26h8" />
              </svg>
              <p>No notebooks yet. Create one or import a file.</p>
            </div>
          ) : (
            <div role="list" aria-label="Notebooks" className="notebook-list">
              {list.map((notebook) => (
                <a
                  key={notebook.id}
                  role="listitem"
                  href={`/notebooks/${notebook.id}`}
                  className="card notebook-card"
                  aria-label={notebook.title}
                >
                  <h2 className="card__title">{notebook.title}</h2>
                  <p className="card__meta" style={{ margin: 0 }}>
                    {notebook.owner_display_name} · {notebook.role === "owner" ? "Owner" : notebook.role === "editor" ? "Editor" : "Viewer"}
                  </p>
                  <p className="card__modified" style={{ margin: "2px 0 0" }}>Modified {formatModified(notebook.modified_at)}</p>
                </a>
              ))}
            </div>
          )}
        </div>
      </main>

      {dialog === "new" ? (
        <Dialog labelledBy="new-notebook-title" onClose={() => setDialog(null)}>
          <h2 className="dialog__title" id="new-notebook-title">New notebook</h2>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              const title = String(new FormData(event.currentTarget).get("title") ?? "");
              const result = await api.createNotebook(title);
              if (result.ok) {
                redirectTo(`/notebooks/${result.value.notebook.id}`);
              }
            }}
          >
            <label className="field">
              <span className="field__label">Title</span>
              <input className="field__input" name="title" required maxLength={120} />
            </label>
            <div className="dialog__actions">
              <button className="button--accent" type="submit">Create</button>
            </div>
          </form>
        </Dialog>
      ) : null}

      {dialog === "import" ? (
        <Dialog labelledBy="import-notebook-title" onClose={() => { setDialog(null); setImportErrors(null); setImportNotice(null); }}>
          <h2 className="dialog__title" id="import-notebook-title">Import notebook</h2>
          {importNotice !== null ? <div className="alert" role="alert"><p className="alert__title" style={{ margin: 0 }}>{importNotice}</p></div> : null}
          {importErrors !== null && importErrors.length > 0 ? (
            <div className="alert" role="alert">
              <p className="alert__title">This file has {importErrors.length} problem{importErrors.length === 1 ? "" : "s"}:</p>
              <ul role="list" aria-label="Import errors" style={{ margin: 0, paddingLeft: 20 }}>
                {importErrors.map((line) => (
                  <li key={line} style={{ fontFamily: "var(--font-code)", fontSize: "0.82rem" }}>{line}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const file = fileInputRef.current?.files?.[0];
              const title = String(form.get("title") ?? "");
              if (file === undefined) return;
              setImportBusy(true);
              setImportNotice("Importing…");
              setImportErrors(null);
              const result = await api.importNotebook(file, title === "" ? "Imported notebook" : title);
              setImportBusy(false);
              if (result.ok) {
                redirectTo(`/notebooks/${result.value.notebook.id}`);
                return;
              }
              setImportNotice(null);
              if (result.error.error === "too_large") {
                setImportErrors([result.error.message]);
                return;
              }
              if (result.error.error === "storage_unavailable") {
                setImportNotice("Import failed: storage unavailable");
                return;
              }
              const errors = result.error.errors ?? [];
              if (errors.length > 0) {
                setImportErrors(errors.map((entry) => `${entry.path}: ${entry.message}`));
                return;
              }
              setImportNotice("Import failed.");
            }}
          >
            <label className="field">
              <span className="field__label">Notebook file</span>
              <input className="field__input" type="file" name="file" ref={fileInputRef} required accept=".ipynb,application/json" />
            </label>
            <label className="field">
              <span className="field__label">Title</span>
              <input className="field__input" name="title" maxLength={120} placeholder="Imported notebook" />
            </label>
            <div className="dialog__actions">
              <button className="button--accent" type="submit" disabled={importBusy}>Import</button>
            </div>
          </form>
        </Dialog>
      ) : null}
    </>
  );
}
