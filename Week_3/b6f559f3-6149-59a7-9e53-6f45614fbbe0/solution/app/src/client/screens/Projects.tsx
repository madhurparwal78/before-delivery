import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { FilePlus2, FolderInput, RotateCcw } from 'lucide-react';
import '../styles/pages.css';
import { formatDate } from '../../shared/format';
import { importCreated, importing, MESSAGES, movedToTrash, restored } from '../../shared/messages';
import type { ProjectSummary } from '../../shared/types';
import { api, ApiError, publicSettings } from '../api';
import { navigate } from '../router';
import { useSession } from '../session';
import { WorkspaceFooter, WorkspaceHeader } from '../ui/Chrome';
import { Dialog } from '../ui/Dialog';
import { ProjectCard } from './projects/ProjectCard';

type Tab = 'Active' | 'Trash';
const TABS: Tab[] = ['Active', 'Trash'];

interface Lists {
  active: ProjectSummary[];
  trashed: ProjectSummary[];
}

function NewProjectDialog({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const create = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (pending) return;
    if (name.trim().length === 0) {
      setError(MESSAGES.enterName);
      return;
    }
    setPending(true);
    try {
      const { project } = await api.post<{ project: ProjectSummary }>('/api/projects', { workspaceId, name: name.trim() });
      navigate(`/projects/${project.id}`);
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : MESSAGES.invalidValue);
      setPending(false);
    }
  };

  return (
    <Dialog name="New project" onClose={onClose}>
      <form onSubmit={(event) => void create(event)} noValidate className="dialog-form">
        <div className="dialog-head">
          <h2>New project</h2>
        </div>
        <label className="field-label">
          Project name
          <input type="text" value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" data-autofocus />
        </label>
        {error && (
          <p className="notice" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={pending}>
            Create project
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function Projects() {
  const session = useSession();
  const { timeZone } = publicSettings();
  const [tab, setTab] = useState<Tab>('Active');
  const [lists, setLists] = useState<Lists | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const chooser = useRef<HTMLInputElement>(null);
  const workspaceId = session.workspaces.find((workspace) => workspace.role === 'Owner')?.id ?? null;

  useEffect(() => {
    if (session.status === 'out') navigate('/signin', true);
  }, [session.status]);

  const load = useCallback(async () => {
    const [active, trashed] = await Promise.all([
      api.get<{ projects: ProjectSummary[] }>('/api/projects?status=active'),
      api.get<{ projects: ProjectSummary[] }>('/api/projects?status=trashed'),
    ]);
    setLists({ active: active.projects, trashed: trashed.projects });
  }, []);

  useEffect(() => {
    if (session.status === 'in') void load();
  }, [session.status, load]);

  const act = async (run: () => Promise<string>): Promise<void> => {
    setError(null);
    try {
      setStatus(await run());
      await load();
    } catch (failure) {
      if (!(failure instanceof ApiError)) throw failure;
      setStatus('');
      setError(failure.message);
    }
  };

  const trash = (project: ProjectSummary): Promise<void> =>
    act(async () => {
      await api.delete(`/api/projects/${project.id}`);
      return movedToTrash(project.name);
    });

  const restore = (project: ProjectSummary): Promise<void> =>
    act(async () => {
      await api.post(`/api/projects/${project.id}/restore`);
      return restored(project.name);
    });

  const importFile = async (file: File): Promise<void> => {
    if (!workspaceId) return;
    setError(null);
    setStatus(importing(file.name));
    const form = new FormData();
    form.set('workspaceId', workspaceId);
    form.set('file', file);
    try {
      const { project } = await api.upload<{ project: ProjectSummary }>('/api/imports', form);
      setStatus(importCreated(project.name.replace(/ \(imported\)$/, '')));
      await load();
    } catch (failure) {
      if (!(failure instanceof ApiError)) throw failure;
      setStatus('');
      setError(failure.errors['file'] ?? failure.message);
    }
  };

  const moveTab = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    const next = TABS[(index + delta + TABS.length) % TABS.length] as Tab;
    setTab(next);
    document.getElementById(`projects-tab-${next}`)?.focus();
  };

  // The page's actions depend on the person's role, so nothing below the header is laid out before the session is known.
  if (session.status === 'loading') return <WorkspaceHeader />;

  return (
    <>
      <WorkspaceHeader />
      <main className="projects-page">
        <div className="projects-head">
          <h1>
            Your <span className="serif-word">projects</span>
          </h1>
          {workspaceId && (
            <div className="projects-actions">
              <button type="button" className="btn" onClick={() => setCreating(true)}>
                <FilePlus2 size={18} aria-hidden="true" /> New project
              </button>
              <button type="button" className="btn" onClick={() => chooser.current?.click()}>
                <FolderInput size={18} aria-hidden="true" /> Import JSON
              </button>
              <input
                ref={chooser}
                type="file"
                accept="application/json,.json"
                aria-label="Choose JSON file"
                className="sr-only"
                tabIndex={-1}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) void importFile(file);
                }}
              />
            </div>
          )}
        </div>
        <div role="tablist" aria-label="Projects" className="projects-tabs">
          {TABS.map((name, index) => (
            <button
              key={name}
              id={`projects-tab-${name}`}
              type="button"
              role="tab"
              aria-selected={tab === name}
              aria-controls="projects-panel"
              tabIndex={tab === name ? 0 : -1}
              className="projects-tab"
              onClick={() => setTab(name)}
              onKeyDown={(event) => moveTab(event, index)}
            >
              {name}
            </button>
          ))}
        </div>
        <div role="status" aria-label="Editor status" className="projects-status">
          {status}
        </div>
        {error && (
          <p className="notice" role="alert">
            {error}
          </p>
        )}
        <div id="projects-panel" role="tabpanel" aria-labelledby={`projects-tab-${tab}`}>
          {lists === null ? (
            <div className="mosaic" aria-busy="true">
              {[0, 1, 2].map((slot) => (
                <div key={slot} className="project-card skeleton-card" />
              ))}
            </div>
          ) : tab === 'Active' ? (
            lists.active.length === 0 ? (
              <EmptyState text="No projects yet." />
            ) : (
              <div className="mosaic">
                {lists.active.map((project) => (
                  <ProjectCard key={project.id} project={project} onTrash={(p) => void trash(p)} />
                ))}
              </div>
            )
          ) : lists.trashed.length === 0 ? (
            <EmptyState text="The trash is empty." />
          ) : (
            <ul className="trash-list">
              {lists.trashed.map((project) => (
                <li key={project.id} aria-label={project.name} className="trash-item panel">
                  <span>
                    {project.name} · purges on {formatDate(project.purgeAt ?? '', timeZone)}
                  </span>
                  <button type="button" className="btn" aria-label={`Restore ${project.name}`} onClick={() => void restore(project)}>
                    <RotateCcw size={18} aria-hidden="true" /> Restore
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
      {lists !== null && <WorkspaceFooter />}
      {creating && workspaceId && <NewProjectDialog workspaceId={workspaceId} onClose={() => setCreating(false)} />}
    </>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="empty-state panel">
      <svg viewBox="0 0 160 90" width="120" height="68" aria-hidden="true">
        <rect x="0.5" y="0.5" width="159" height="89" rx="6" fill="none" stroke="currentColor" opacity="0.5" />
        <circle cx="80" cy="45" r="14" fill="none" stroke="currentColor" opacity="0.6" />
      </svg>
      <p className="muted">{text}</p>
    </div>
  );
}
