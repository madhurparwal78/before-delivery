import { useEffect, useId, useRef, useState } from 'react';
import type { FieldError, Notebook, NotebookListEntry } from '../../shared/types.js';
import { ApiFailure, apiGet, apiSend, apiUpload } from '../api.js';
import { useApp } from '../app.js';
import { Dialog } from '../components/Dialog.js';
import { EmptyStateIcon } from '../components/graphics.js';
import { WorkspaceHeader } from '../components/Header.js';

const SEARCH_DELAY_MS = 500;

function modifiedLabel(iso: string): string {
  const date = new Date(iso);
  return `Modified ${date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

function roleLabel(role: NotebookListEntry['role']): string {
  if (role === 'owner') return 'Owner';
  return role === 'editor' ? 'Editor' : 'Viewer';
}

function NewNotebookDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const app = useApp();
  const base = useId();
  const [title, setTitle] = useState('');
  const [errors, setErrors] = useState<FieldError[]>([]);

  const create = async (): Promise<void> => {
    setErrors([]);
    try {
      const answer = await apiSend<{ notebook: Notebook }>('POST', '/api/notebooks', { title });
      app.navigate(`/notebooks/${answer.notebook.id}`);
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 422) setErrors(error.fieldErrors);
      else throw error;
    }
  };

  return (
    <Dialog name="New notebook" onClose={onClose}>
      <h2>New notebook</h2>
      <div className="field">
        <label htmlFor={`${base}-title`}>Title</label>
        <input
          id={`${base}-title`}
          type="text"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        {errors.map((error) => (
          <p className="field-error" key={error.path}>
            {error.message}
          </p>
        ))}
      </div>
      <div className="button-row">
        <button
          type="button"
          className="button-embossed"
          onClick={() => {
            void create();
          }}
        >
          Create
        </button>
        <button type="button" className="button-plain" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}

function ImportDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const app = useApp();
  const base = useId();
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<'idle' | 'importing'>('idle');
  const [alertText, setAlertText] = useState<string | null>(null);
  const [problems, setProblems] = useState<FieldError[]>([]);

  const runImport = async (): Promise<void> => {
    if (!file) return;
    setAlertText(null);
    setProblems([]);
    setState('importing');
    try {
      const path = `/api/notebooks/import?title=${encodeURIComponent(title === '' ? file.name.replace(/\.ipynb$/, '') : title)}`;
      const answer = await apiUpload<{ notebook: Notebook }>(path, file);
      app.navigate(`/notebooks/${answer.notebook.id}`);
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
      if (error.status === 413) setAlertText(error.message);
      else if (error.status === 422) setProblems(error.fieldErrors);
      else if (error.code === 'storage_unavailable') setAlertText('Import failed: storage unavailable');
      else setAlertText(error.message);
    } finally {
      setState('idle');
    }
  };

  return (
    <Dialog name="Import notebook" onClose={onClose}>
      <h2>Import notebook</h2>
      {alertText ? (
        <div className="error-summary" role="alert">
          <p>{alertText}</p>
        </div>
      ) : null}
      {problems.length > 0 ? (
        <div className="import-problems">
          <p>{problems.length === 1 ? 'This file has 1 problem:' : `This file has ${problems.length} problems:`}</p>
          <ul aria-label="Import errors">
            {problems.map((problem, index) => (
              <li key={`${problem.path}-${index}`}>{`${problem.path}: ${problem.message}`}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="field">
        <label htmlFor={`${base}-file`}>Notebook file</label>
        <input
          id={`${base}-file`}
          type="file"
          accept=".ipynb,application/json"
          onChange={(event) => setFile(event.target.files?.item(0) ?? null)}
        />
      </div>
      <div className="field">
        <label htmlFor={`${base}-title`}>Title</label>
        <input
          id={`${base}-title`}
          type="text"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </div>
      {state === 'importing' ? <p className="form-notice">Importing…</p> : null}
      <div className="button-row">
        <button
          type="button"
          className="button-embossed"
          onClick={() => {
            void runImport();
          }}
        >
          Import
        </button>
        <button type="button" className="button-plain" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}

export function FileBrowser(): JSX.Element {
  const app = useApp();
  const searchId = useId();
  const [notebooks, setNotebooks] = useState<NotebookListEntry[]>([]);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<{ id: string; title: string }[] | null>(null);
  const [searchStatus, setSearchStatus] = useState('');
  const [searchDown, setSearchDown] = useState(false);
  const [dialog, setDialog] = useState<'none' | 'new' | 'import'>('none');
  const timer = useRef<number | null>(null);

  const load = async (): Promise<void> => {
    const answer = await apiGet<{ notebooks: NotebookListEntry[] }>('/api/notebooks');
    setNotebooks(answer.notebooks);
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    if (query.trim() === '') {
      setMatches(null);
      setSearchDown(false);
      setSearchStatus('');
      return;
    }
    timer.current = window.setTimeout(() => {
      void (async () => {
        try {
          const answer = await apiGet<{ results: { id: string; title: string }[] }>(
            `/api/search?q=${encodeURIComponent(query.trim())}`,
          );
          setSearchDown(false);
          setMatches(answer.results);
          setSearchStatus(
            answer.results.length === 1 ? '1 notebook found' : `${answer.results.length} notebooks found`,
          );
        } catch (error) {
          if (error instanceof ApiFailure && error.code === 'search_unavailable') {
            setSearchDown(true);
            setMatches(null);
            setSearchStatus('Search is unavailable');
            return;
          }
          throw error;
        }
      })();
    }, SEARCH_DELAY_MS);
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [query]);

  const shown =
    matches === null
      ? notebooks
      : matches
          .map((match) => notebooks.find((notebook) => notebook.id === match.id))
          .filter((notebook): notebook is NotebookListEntry => notebook !== undefined);

  return (
    <div className="page">
      <WorkspaceHeader>
        <span className="header-person">{app.user ? app.user.display_name : ''}</span>
        <button
          type="button"
          className="button-plain"
          onClick={() => {
            void apiSend('POST', '/api/auth/signout').then(() => {
              app.setUser(null);
              app.navigate('/');
            });
          }}
        >
          Sign out
        </button>
      </WorkspaceHeader>
      <section className="band band-grey band-tall">
        <div className="container">
          <h1>Your notebooks</h1>
          <div className="browser-actions">
            <div className="field search-field">
              <label htmlFor={searchId}>Search notebooks</label>
              <input
                id={searchId}
                type="search"
                role="searchbox"
                placeholder="Search titles, cells and headings"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <div className="button-row">
              <button type="button" className="button-plain" onClick={() => setDialog('new')}>
                New notebook
              </button>
              <button type="button" className="button-plain" onClick={() => setDialog('import')}>
                Import notebook
              </button>
            </div>
          </div>
          <p className="search-status" role="status" aria-label="Search status">
            {searchStatus}
          </p>
          {searchDown ? <p className="notice">Search is unavailable</p> : null}
          {notebooks.length === 0 ? (
            <div className="empty-state">
              <EmptyStateIcon />
              <p>No notebooks yet. Create one or import a file.</p>
            </div>
          ) : null}
          {matches !== null && shown.length === 0 ? (
            <p className="notice">{`No notebooks match “${query.trim()}”.`}</p>
          ) : null}
          <ul className="notebook-list" aria-label="Notebooks">
            {(searchDown ? notebooks : shown).map((notebook) => (
              <li key={notebook.id}>
                <a
                  className="card notebook-card"
                  href={`/notebooks/${notebook.id}`}
                  onClick={(event) => {
                    event.preventDefault();
                    app.navigate(`/notebooks/${notebook.id}`);
                  }}
                >
                  <h2>{notebook.title}</h2>
                  <p className="owner">{notebook.owner_display_name}</p>
                  <p className="role">{roleLabel(notebook.role)}</p>
                  <p className="meta">{modifiedLabel(notebook.modified_at)}</p>
                </a>
              </li>
            ))}
          </ul>
        </div>
      </section>
      {dialog === 'new' ? <NewNotebookDialog onClose={() => setDialog('none')} /> : null}
      {dialog === 'import' ? <ImportDialog onClose={() => setDialog('none')} /> : null}
    </div>
  );
}
