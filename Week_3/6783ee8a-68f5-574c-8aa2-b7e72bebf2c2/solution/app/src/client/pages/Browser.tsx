import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { BookOpen } from "lucide-react";
import type { NotebookListItem } from "../../shared/api";
import { ApiFailure, api, get, post } from "../api";
import { Dialog } from "../components/Dialog";
import { Link } from "../components/Link";
import { SiteHeader } from "../components/SiteHeader";
import { navigate, useLocation } from "../router";
import { useSession } from "../session";

const DEBOUNCE_MS = 500;

const when = (iso: string): string => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

function NewDialog({ onClose }: { onClose: () => void }): ReactNode {
  const [title, setTitle] = useState("");
  const [problem, setProblem] = useState("");
  const create = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    try {
      const made = await post<{ notebook: { id: string } }>("/api/notebooks", { title });
      navigate(`/notebooks/${made.notebook.id}`);
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
      setProblem(error.body.errors?.[0]?.message ? `Title ${error.body.errors[0].message}` : error.message);
    }
  };
  return (
    <Dialog label="New notebook" onClose={onClose}>
      <h2>New notebook</h2>
      <form onSubmit={(event) => void create(event)} noValidate>
        <label className="field">
          <span className="label">Title</span>
          <input type="text" aria-label="Title" value={title} onChange={(event) => setTitle(event.target.value)} />
          {problem && <span className="error" role="alert">{problem}</span>}
        </label>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-accent">Create</button>
        </div>
      </form>
    </Dialog>
  );
}

interface ImportProblem {
  kind: "large" | "invalid" | "storage" | "other";
  message: string;
  errors?: { path: string; message: string }[];
}

function ImportDialog({ onClose }: { onClose: () => void }): ReactNode {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<ImportProblem | null>(null);

  const send = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!file) return;
    setBusy(true);
    setProblem(null);
    try {
      const made = await api<{ notebook: { id: string } }>("POST", `/api/notebooks/import?title=${encodeURIComponent(title || file.name.replace(/\.[^.]*$/, ""))}`, undefined, file);
      navigate(`/notebooks/${made.notebook.id}`);
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
      if (error.status === 413) setProblem({ kind: "large", message: error.body.message });
      else if (error.status === 422) setProblem({ kind: "invalid", message: error.body.message, errors: error.body.errors });
      else if (error.status === 503 || error.status === 0) setProblem({ kind: "storage", message: "Import failed: storage unavailable" });
      else setProblem({ kind: "other", message: error.message });
    } finally {
      setBusy(false);
    }
  };

  const count = problem?.errors?.length ?? 0;
  return (
    <Dialog label="Import notebook" onClose={onClose}>
      <h2>Import notebook</h2>
      <form onSubmit={(event) => void send(event)} noValidate>
        <label className="field">
          <span className="label">Notebook file</span>
          <input type="file" aria-label="Notebook file" accept=".ipynb,.json,application/json" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
        </label>
        <label className="field">
          <span className="label">Title</span>
          <input type="text" aria-label="Title" value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        {busy && <p role="status">Importing…</p>}
        {problem && (problem.kind === "invalid" ? (
          <div className="import-problems">
            <p>{`This file has ${count} ${count === 1 ? "problem" : "problems"}:`}</p>
            <ul aria-label="Import errors">
              {problem.errors?.map((entry, index) => <li key={index}>{`${entry.path}: ${entry.message}`}</li>)}
            </ul>
          </div>
        ) : (
          <p role="alert" className="error-line">{problem.message}</p>
        ))}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-accent" disabled={busy}>Import</button>
        </div>
      </form>
    </Dialog>
  );
}

/** The file browser: every notebook the person can open, newest modified first, with search through Meilisearch. */
export function Browser(): ReactNode {
  const { user } = useSession();
  const params = new URLSearchParams(useLocation().split("?")[1]);
  const [notebooks, setNotebooks] = useState<NotebookListItem[] | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<string[] | null>(null);
  const [searchStatus, setSearchStatus] = useState("");
  const [searchDown, setSearchDown] = useState(false);
  const [dialog, setDialog] = useState<"new" | "import" | null>(params.has("new") ? "new" : params.has("import") ? "import" : null);
  const timer = useRef(0);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    get<{ notebooks: NotebookListItem[] }>("/api/notebooks").then((found) => setNotebooks(found.notebooks), () => setNotebooks([]));
  }, []);

  const search = async (text: string): Promise<void> => {
    try {
      const found = await get<{ results: { id: string }[] }>(`/api/search?q=${encodeURIComponent(text)}`);
      setSearchDown(false);
      setHits(found.results.map((r) => r.id));
      setSearchStatus(found.results.length === 1 ? "1 notebook found" : `${found.results.length} notebooks found`);
    } catch {
      setSearchDown(true);
      setHits(null);
      setSearchStatus("");
    }
  };

  const typed = (text: string): void => {
    setQuery(text);
    window.clearTimeout(timer.current);
    if (text.trim() === "") {
      setHits(null);
      setSearchDown(false);
      setSearchStatus("");
      return;
    }
    timer.current = window.setTimeout(() => void search(text), DEBOUNCE_MS);
  };

  const shown = notebooks === null ? [] : hits === null ? notebooks : notebooks.filter((n) => hits.includes(n.id)).sort((a, b) => hits.indexOf(a.id) - hits.indexOf(b.id));
  const close = (): void => {
    setDialog(null);
    if (params.has("new") || params.has("import")) navigate("/notebooks", true);
  };

  return (
    <>
      <SiteHeader signOutButton />
      <main className="band browser-band">
        <div className="container">
          <h1 className="section-title">Your notebooks</h1>
          <div className="browser-tools">
            <input type="search" role="searchbox" className="search" aria-label="Search notebooks" placeholder="Search titles, cells and headings" value={query} onChange={(event) => typed(event.target.value)} />
            <div className="browser-buttons">
              <button type="button" className="btn btn-accent" onClick={(event) => { opener.current = event.currentTarget; setDialog("new"); }}>New notebook</button>
              <button type="button" className="btn" onClick={() => setDialog("import")}>Import notebook</button>
            </div>
          </div>
          <div role="status" aria-label="Search status" aria-live="polite" className={searchStatus ? "muted" : "sr-only"}>{searchStatus}</div>
          {searchDown && <p className="notice">Search is unavailable</p>}
          {notebooks !== null && hits !== null && !searchDown && shown.length === 0 && <p className="empty-line">{`No notebooks match “${query}”.`}</p>}
          {notebooks !== null && notebooks.length === 0 && (
            <div className="empty">
              <BookOpen size={48} strokeWidth={1.5} aria-hidden="true" />
              <p>No notebooks yet. Create one or import a file.</p>
            </div>
          )}
          {notebooks === null && <p className="muted">Loading…</p>}
          {shown.length > 0 && (
            <ul aria-label="Notebooks" className="nb-list">
              {shown.map((notebook) => (
                <li key={notebook.id}>
                  <Link to={`/notebooks/${notebook.id}`} className="nb-card" aria-describedby={`nb-card-info-${notebook.id}`}>
                    <span className="nb-card-title">{notebook.title}</span>
                    <span className="nb-card-info" id={`nb-card-info-${notebook.id}`} aria-hidden="true">
                      <span className="nb-card-meta">{`${notebook.owner_display_name} · ${notebook.role === "owner" ? "Owner" : notebook.role === "editor" ? "Editor" : "Viewer"}`}</span>
                      <span className="nb-card-date italic">{`Modified ${when(notebook.modified_at)}`}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <p className="sr-only">{user?.display_name}</p>
        </div>
      </main>
      {dialog === "new" && <NewDialog onClose={close} />}
      {dialog === "import" && <ImportDialog onClose={close} />}
    </>
  );
}
