import { useEffect, useState } from 'preact/hooks';
import { useRoute } from 'preact-iso';
import { StudioLayout } from './StudioLayout';
import { GenerationCard } from './GenerationCard';
import { Generation, Project, useRendering } from './data';
import { api, ApiError } from '../api';
import { Dialog, Spinner } from '../components/ui';
import { PlusMark } from '../components/Icons';
import { useAuth } from '../store';
import { dayHeading, longDate } from '../format';

function projectProblem(error: unknown): string {
  if (!(error instanceof ApiError)) return 'That project could not be saved.';
  if (error.code === 'duplicate_name') return 'A project with this name already exists.';
  if (error.code === 'project_limit') {
    const limit = error.payload.limit as number;
    return `Your plan allows up to ${limit} project${limit === 1 ? '' : 's'}.`;
  }
  return Object.values(error.fieldErrors)[0] ?? 'That project could not be saved.';
}

function NewProjectDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [problem, setProblem] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (event: Event) => {
    event.preventDefault();
    setSaving(true);
    setProblem('');
    try {
      await api('/api/projects', { method: 'POST', body: { name } });
      onCreated();
      onClose();
    } catch (error) {
      setProblem(projectProblem(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog title="New project" onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <div class="field">
          <label for="field-project-name">Project name</label>
          <input
            class="input"
            id="field-project-name"
            name="project_name"
            value={name}
            aria-invalid={problem ? 'true' : undefined}
            aria-describedby={problem ? 'field-project-name-error' : undefined}
            onInput={(event) => setName((event.target as HTMLInputElement).value)}
          />
          {problem ? (
            <span class="field-error" id="field-project-name-error" role="alert">
              {problem}
            </span>
          ) : null}
        </div>
        <div class="dialog-actions">
          <button type="button" class="btn btn-light" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" class="btn btn-accent" disabled={saving}>
            {saving ? <Spinner /> : null}
            Create
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function Projects() {
  const auth = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);

  const reload = async () => setProjects(await api<Project[]>('/api/projects'));

  useEffect(() => {
    if (auth.state === 'signed-in') void reload();
  }, [auth.state]);

  return (
    <StudioLayout current="projects">
      <div class="studio-head">
        <h1 style="font-size:clamp(1.8rem,3vw,2.3rem);margin:0">Projects</h1>
        <button type="button" class="btn btn-accent" onClick={() => setDialogOpen(true)}>
          <PlusMark />
          New project
        </button>
      </div>

      {projects.length === 0 ? (
        <div class="empty-state">
          <p>No projects yet</p>
          <button type="button" class="btn btn-accent" onClick={() => setDialogOpen(true)}>
            <PlusMark />
            New project
          </button>
        </div>
      ) : (
        <div class="card-grid card-grid-2">
          {projects.map((project) => (
            <a class="card lift" href={`/studio/projects/${project.id}`} key={project.id}>
              <h2 style="font-size:1.15rem">{project.name}</h2>
              <p class="muted mono" style="margin:0">
                {project.generation_count} generations
              </p>
              <p class="muted" style="margin:6px 0 0">
                {project.last_generation_at ? longDate(project.last_generation_at) : 'No generations yet'}
              </p>
            </a>
          ))}
        </div>
      )}

      {dialogOpen ? (
        <NewProjectDialog onClose={() => setDialogOpen(false)} onCreated={() => void reload()} />
      ) : null}
    </StudioLayout>
  );
}

export function ProjectTimeline() {
  const { params } = useRoute();
  const auth = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [missing, setMissing] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const [problem, setProblem] = useState('');

  const reload = async () => {
    try {
      const projects = await api<Project[]>('/api/projects');
      const found = projects.find((item) => item.id === params.id);
      if (!found) {
        setMissing(true);
        return;
      }
      setProject(found);
      setName(found.name);
      setGenerations(await api<Generation[]>(`/api/projects/${params.id}/generations`));
    } catch {
      setMissing(true);
    }
  };

  useEffect(() => {
    if (auth.state === 'signed-in') void reload();
  }, [auth.state, params.id]);

  useRendering(generations, () => void reload());

  const rename = async (event: Event) => {
    event.preventDefault();
    setProblem('');
    try {
      await api(`/api/projects/${params.id}`, { method: 'PATCH', body: { name } });
      setRenaming(false);
      void reload();
    } catch (error) {
      setProblem(projectProblem(error));
    }
  };

  if (missing) {
    return (
      <StudioLayout current="projects">
        <h1 style="font-size:clamp(1.8rem,3vw,2.3rem)">That project does not exist.</h1>
        <a class="btn btn-light" href="/studio/projects">
          Back to projects
        </a>
      </StudioLayout>
    );
  }

  const days: { heading: string; items: Generation[] }[] = [];
  for (const generation of generations) {
    const heading = dayHeading(generation.created_at);
    const last = days[days.length - 1];
    if (last && last.heading === heading) last.items.push(generation);
    else days.push({ heading, items: [generation] });
  }

  return (
    <StudioLayout current="projects">
      <div class="studio-head">
        {renaming ? (
          <form onSubmit={rename} class="row-between" style="gap:10px">
            <div class="field" style="margin:0">
              <label for="field-rename">Project name</label>
              <input
                class="input"
                id="field-rename"
                name="rename"
                value={name}
                aria-invalid={problem ? 'true' : undefined}
                aria-describedby={problem ? 'field-rename-error' : undefined}
                onInput={(event) => setName((event.target as HTMLInputElement).value)}
              />
              {problem ? (
                <span class="field-error" id="field-rename-error" role="alert">
                  {problem}
                </span>
              ) : null}
            </div>
            <button type="submit" class="btn btn-accent">
              Save
            </button>
            <button
              type="button"
              class="btn btn-light"
              onClick={() => {
                setRenaming(false);
                setProblem('');
                setName(project?.name ?? '');
              }}
            >
              Cancel
            </button>
          </form>
        ) : (
          <>
            <h1 style="font-size:clamp(1.8rem,3vw,2.3rem);margin:0">{project?.name ?? ''}</h1>
            <button type="button" class="btn btn-light" onClick={() => setRenaming(true)}>
              Rename
            </button>
          </>
        )}
      </div>

      {generations.length === 0 ? (
        <div class="empty-state">
          <p style="margin:0 0 12px">No generations yet. Start one from the composer.</p>
          <a class="btn btn-accent" href="/studio">
            Open the composer
          </a>
        </div>
      ) : (
        days.map((day) => (
          <section key={day.heading}>
            <h2 class="day-heading">{day.heading}</h2>
            <div class="card-grid card-grid-2">
              {day.items.map((generation) => (
                <GenerationCard
                  key={generation.id}
                  generation={generation}
                  onChanged={() => {
                    void auth.refresh();
                    void reload();
                  }}
                />
              ))}
            </div>
          </section>
        ))
      )}
    </StudioLayout>
  );
}
