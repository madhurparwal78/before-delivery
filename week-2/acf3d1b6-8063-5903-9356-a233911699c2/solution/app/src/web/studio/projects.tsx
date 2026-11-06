import { useEffect, useState } from 'preact/hooks';
import { Spinner } from '../ui/spinner.js';
import { checkProjectName } from '../../shared/rules.js';
import { api } from '../api.js';
import type { Generation, Project } from '../data.js';
import { dayHeading, formatDate } from '../format.js';
import { Art } from '../ui/art.js';
import { Dialog } from '../ui/dialog.js';
import { Plus } from '../ui/icons.js';
import { useToast } from '../ui/toast.js';
import { GenerationCard, useGenerationUpdates } from './generation-card.js';

/** The words for a refused project name, create or rename. */
function projectRefusal(reply: { error?: string; errors?: Record<string, string>; data: unknown }): string {
  if (reply.error === 'duplicate_name') return 'A project with this name already exists.';
  if (reply.error === 'project_limit') {
    const limit = (reply.data as { limit: number }).limit;
    return `Your plan allows up to ${limit} ${limit === 1 ? 'project' : 'projects'}.`;
  }
  return reply.errors?.name ?? 'That project could not be saved.';
}

function NewProjectDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (project: Project) => void }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event: Event) => {
    event.preventDefault();
    const checked = checkProjectName({ name });
    if (!checked.ok) return setError(checked.errors.name);
    setBusy(true);
    const reply = await api<Project>('POST', '/projects', { name });
    setBusy(false);
    if (reply.ok) onCreated(reply.data);
    else setError(projectRefusal(reply));
  };
  return (
    <Dialog title="New project" onClose={onClose}>
      <form class="stack" noValidate onSubmit={submit}>
        <div class={`field${error ? ' has-error' : ''}`}>
          <label for="project-name">Project name</label>
          <input
            id="project-name"
            class="input"
            data-autofocus
            value={name}
            maxLength={120}
            onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
            aria-describedby={error ? 'project-name-error' : undefined}
            aria-invalid={error ? 'true' : undefined}
          />
          {error && (
            <p id="project-name-error" class="field-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div class="dialog-actions">
          <button type="button" class="button button-light" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" class="button button-dark" disabled={busy}>
            {busy && <Spinner />}
            Create
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function NewProjectButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" class="button button-light" onClick={onClick}>
      <Plus size={16} /> New project
    </button>
  );
}

export function ProjectsPage() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [creating, setCreating] = useState(false);
  const toast = useToast();

  useEffect(() => {
    api<Project[]>('GET', '/projects').then((reply) => reply.ok && setProjects(reply.data));
  }, []);

  return (
    <div class="studio-page">
      <div class="page-head">
        <h1 class="heading studio-title">Projects</h1>
        <NewProjectButton onClick={() => setCreating(true)} />
      </div>
      {projects === null ? (
        <div class="card-grid">
          <div class="skeleton skeleton-project" />
          <div class="skeleton skeleton-project" />
          <div class="skeleton skeleton-project" />
        </div>
      ) : projects.length === 0 ? (
        <div class="empty">
          <Art phrase="No projects yet, an empty shelf of soft light" aspect="16:9" class="empty-art" />
          <p class="empty-title">No projects yet</p>
          <NewProjectButton onClick={() => setCreating(true)} />
        </div>
      ) : (
        <ul class="card-grid project-grid">
          {projects.map((project) => (
            <li key={project.id}>
              <a class="card project-card" href={`/studio/projects/${project.id}`}>
                <Art phrase={project.name} aspect="16:9" class="project-art" />
                <span class="project-name">{project.name}</span>
                <span class="project-meta">
                  {project.generation_count} {project.generation_count === 1 ? 'generation' : 'generations'} ·{' '}
                  {project.latest_generation_at ? formatDate(project.latest_generation_at) : 'No generations yet'}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
      {creating && (
        <NewProjectDialog
          onClose={() => setCreating(false)}
          onCreated={(project) => {
            setProjects((list) => [project, ...(list ?? [])]);
            setCreating(false);
            toast('Project created.');
          }}
        />
      )}
    </div>
  );
}

function ProjectName({ project, onRenamed }: { project: Project; onRenamed: (project: Project) => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(project.name);
  const [error, setError] = useState('');
  const toast = useToast();
  const save = async (event: Event) => {
    event.preventDefault();
    const checked = checkProjectName({ name });
    if (!checked.ok) return setError(checked.errors.name);
    const reply = await api<Project>('PATCH', `/projects/${project.id}`, { name });
    if (!reply.ok) return setError(projectRefusal(reply));
    onRenamed(reply.data);
    setEditing(false);
    setError('');
    toast('Project renamed.');
  };
  if (!editing) {
    return (
      <div class="page-head">
        <h1 class="heading studio-title">{project.name}</h1>
        <button
          type="button"
          class="button button-light"
          onClick={() => {
            setName(project.name);
            setEditing(true);
          }}
        >
          Rename
        </button>
      </div>
    );
  }
  return (
    <form class="rename" noValidate onSubmit={save}>
      <h1 class="sr-only">{project.name}</h1>
      <div class={`field${error ? ' has-error' : ''}`}>
        <label for="rename">Project name</label>
        <input
          id="rename"
          class="input input-title"
          value={name}
          ref={(el) => el?.focus()}
          onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
          onKeyDown={(e) => e.key === 'Escape' && setEditing(false)}
          aria-describedby={error ? 'rename-error' : undefined}
          aria-invalid={error ? 'true' : undefined}
        />
        {error && (
          <p id="rename-error" class="field-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div class="button-row">
        <button type="submit" class="button button-dark">Save</button>
        <button type="button" class="button button-light" onClick={() => setEditing(false)}>
          Keep name
        </button>
      </div>
    </form>
  );
}

export function ProjectPage({ id }: { id: string }) {
  const [project, setProject] = useState<Project | null | undefined>(undefined);
  const [generations, setGenerations] = useState<Generation[] | null>(null);

  useEffect(() => {
    Promise.all([api<Project[]>('GET', '/projects'), api<Generation[]>('GET', `/projects/${id}/generations`)]).then(
      ([projects, list]) => {
        const found = projects.ok ? projects.data.find((p) => p.id === id) : undefined;
        setProject(found && list.ok ? found : null);
        if (list.ok) setGenerations(list.data);
      },
    );
  }, [id]);

  const replace = (generation: Generation) =>
    setGenerations((list) => list && list.map((item) => (item.id === generation.id ? generation : item)));
  useGenerationUpdates(generations, replace);

  if (project === null) {
    return (
      <div class="studio-page empty">
        <h1 class="heading studio-title">That project does not exist.</h1>
        <a class="button button-light" href="/studio/projects">Back to projects</a>
      </div>
    );
  }
  if (project === undefined || generations === null) {
    return (
      <div class="studio-page">
        <div class="skeleton skeleton-title" />
        <div class="card-grid">
          <div class="skeleton skeleton-card" />
          <div class="skeleton skeleton-card" />
        </div>
      </div>
    );
  }

  const days: { heading: string; items: Generation[] }[] = [];
  for (const generation of generations) {
    const heading = dayHeading(generation.created_at);
    const day = days[days.length - 1];
    if (day?.heading === heading) day.items.push(generation);
    else days.push({ heading, items: [generation] });
  }

  return (
    <div class="studio-page">
      <ProjectName project={project} onRenamed={setProject} />
      {generations.length === 0 ? (
        <div class="empty">
          <Art phrase="No generations yet, a quiet blank sky waiting" aspect="16:9" class="empty-art" />
          <p class="empty-title">No generations yet. Start one from the composer.</p>
          <a class="button button-dark" href="/studio">Open the composer</a>
        </div>
      ) : (
        <div class="timeline">
          {days.map((day) => (
            <section key={day.heading} class="timeline-day" aria-label={day.heading}>
              <h2 class="timeline-heading">{day.heading}</h2>
              <div class="card-grid">
                {day.items.map((generation) => (
                  <GenerationCard key={generation.id} generation={generation} onChange={replace} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
