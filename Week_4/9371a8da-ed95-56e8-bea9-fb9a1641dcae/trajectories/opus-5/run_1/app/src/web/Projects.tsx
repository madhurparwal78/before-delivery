import { useEffect, useRef, useState } from 'react';
import { api, ApiFailure } from './api.js';
import { Dialog } from './components/Dialog.js';
import { copy } from './copy.js';
import { push, replace } from './navigation.js';
import { ProjectSummary, User, Workspace } from './types.js';

interface Props {
  user: User;
  workspace: Workspace | null;
  accessNotice: string | null;
  onUser: (user: User) => void;
  onSignedOut: () => void;
}

export function Projects(props: Props): JSX.Element {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [dialog, setDialog] = useState<'new' | 'profile' | null>(null);
  const newProjectButton = useRef<HTMLButtonElement | null>(null);
  const nameButton = useRef<HTMLButtonElement | null>(null);

  const load = async (): Promise<void> => {
    const answer = await api<{ projects: ProjectSummary[] }>('/api/projects');
    setProjects(answer.projects);
  };

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load().catch(() => undefined), 5_000);
    return () => window.clearInterval(timer);
  }, []);

  const signOut = async (): Promise<void> => {
    await api('/api/session', { method: 'DELETE' }).catch(() => undefined);
    props.onSignedOut();
    replace('/signin');
  };

  return (
    <>
      <header className="app-header">
        <span className="brand">Marginalia</span>
        <button type="button" ref={nameButton} onClick={() => setDialog('profile')}>
          {props.user.displayName}
        </button>
        <button type="button" onClick={() => void signOut()}>
          Sign out
        </button>
      </header>
      <main className="centred-column">
        <h1>Projects</h1>
        {props.workspace?.role === 'owner' ? (
          <button type="button" ref={newProjectButton} onClick={() => setDialog('new')}>
            New project
          </button>
        ) : null}
        <ul className="ruled-list">
          {projects.map((project) => (
            <li key={project.id}>
              <a
                href={`/p/${project.id}?file=main.tex`}
                onClick={(event) => {
                  event.preventDefault();
                  push(`/p/${project.id}?file=main.tex`);
                }}
              >
                {project.title}
              </a>
              <span className="role-word">{project.role}</span>
              <span className="revision">r{project.projectRevision}</span>
            </li>
          ))}
        </ul>
        <p role="status" aria-label="Access notice" className="live-region">
          {props.accessNotice ?? ''}
        </p>
      </main>
      {dialog === 'new' ? (
        <NewProjectDialog
          onClose={() => setDialog(null)}
          returnFocusTo={() => newProjectButton.current}
        />
      ) : null}
      {dialog === 'profile' ? (
        <ProfileDialog
          user={props.user}
          onUser={props.onUser}
          onClose={() => setDialog(null)}
          returnFocusTo={() => nameButton.current}
        />
      ) : null}
    </>
  );
}

function NewProjectDialog(props: {
  onClose: () => void;
  returnFocusTo: () => HTMLElement | null;
}): JSX.Element {
  const [title, setTitle] = useState('');
  const [template, setTemplate] = useState('thesis-numbered');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const create = async (): Promise<void> => {
    setPending(true);
    setError(null);
    try {
      const answer = await api<{ project: ProjectSummary }>('/api/projects', {
        method: 'POST',
        body: { title, template },
      });
      props.onClose();
      push(`/p/${answer.project.id}?file=main.tex`);
    } catch (failure) {
      setError(
        failure instanceof ApiFailure && failure.field('title') !== null
          ? copy.fields.title
          : copy.somethingWrong,
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog name="New project" onClose={props.onClose} returnFocusTo={props.returnFocusTo}>
      <h2>New project</h2>
      <label>
        <span className="field-label">Title</span>
        <input
          value={title}
          aria-describedby={error === null ? undefined : 'title-error'}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      {error === null ? null : (
        <p className="field-error" id="title-error">
          {error}
        </p>
      )}
      <fieldset role="radiogroup" aria-label="Template">
        <legend>Template</legend>
        <label>
          <input
            type="radio"
            name="template"
            checked={template === 'thesis-numbered'}
            onChange={() => setTemplate('thesis-numbered')}
          />
          Thesis, numbered chapters
        </label>
        <label>
          <input
            type="radio"
            name="template"
            checked={template === 'article-single'}
            onChange={() => setTemplate('article-single')}
          />
          Article, single file
        </label>
      </fieldset>
      <button
        type="button"
        onClick={() => void create()}
        disabled={pending}
        aria-busy={pending ? true : undefined}
      >
        Create project
      </button>
    </Dialog>
  );
}

function ProfileDialog(props: {
  user: User;
  onUser: (user: User) => void;
  onClose: () => void;
  returnFocusTo: () => HTMLElement | null;
}): JSX.Element {
  const [name, setName] = useState(props.user.displayName);
  const [error, setError] = useState<string | null>(null);

  const save = async (): Promise<void> => {
    try {
      const answer = await api<{ user: User }>('/api/me', {
        method: 'PATCH',
        body: { displayName: name },
      });
      props.onUser(answer.user);
      props.onClose();
    } catch {
      setError(copy.fields.displayName);
    }
  };

  return (
    <Dialog name="Profile" onClose={props.onClose} returnFocusTo={props.returnFocusTo}>
      <h2>Profile</h2>
      <label>
        <span className="field-label">Display name</span>
        <input
          value={name}
          aria-describedby={error === null ? undefined : 'profile-error'}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      {error === null ? null : (
        <p className="field-error" id="profile-error">
          {error}
        </p>
      )}
      <button type="button" onClick={() => void save()}>
        Save name
      </button>
    </Dialog>
  );
}
