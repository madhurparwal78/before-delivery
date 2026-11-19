import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { api, refusal } from '../api';
import { navigate } from '../router';
import { loadMe, localeOf, useMe, type Me } from '../session';
import { clearAlerts, EmptyState, notify, raise } from '../ui';
import { NUMBER_FORMATS, TIME_ZONES } from '../../shared/rules';
import { Shell } from './Shell';

interface ProjectSummary {
  id: number;
  name: string;
  role: string;
}

/** Sends a signed-out visitor to sign in and holds the page until the session is known. */
export function useRequireMe(): Me | null {
  const me = useMe();
  useEffect(() => {
    if (me === null) navigate(`/signin?next=${encodeURIComponent(location.pathname)}`, true);
  }, [me]);
  return me ?? null;
}

export function Projects(): JSX.Element {
  const me = useRequireMe();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const load = async (): Promise<void> => {
    const result = await api<{ projects: ProjectSummary[] }>('GET', '/api/projects');
    if (result.ok) setProjects(result.body.projects);
  };
  useEffect(() => {
    if (me) void load();
  }, [me?.id]);

  const create = async (event: Event): Promise<void> => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    clearAlerts();
    const result = await api<{ id: number }>('POST', '/api/projects', { name: new FormData(form).get('name') });
    if (!result.ok) {
      const { message, fields } = refusal(result);
      setErrors(fields);
      raise(message);
      return;
    }
    setErrors({});
    form.reset();
    await load();
  };

  const saveSettings = async (event: Event): Promise<void> => {
    event.preventDefault();
    const form = new FormData(event.currentTarget as HTMLFormElement);
    const result = await api<Me>('PATCH', '/api/me', { number_format: form.get('number_format'), time_zone: form.get('time_zone') });
    if (result.ok) {
      await loadMe();
      notify('Settings saved');
    } else raise(refusal(result).message);
  };

  const locale = localeOf(me);
  return (
    <Shell>
      <main class="page-columns">
        <section class="card">
          <h1 class="page-title">Your projects</h1>
          <div class="list-slot">
            {projects === null ? (
              <p class="loading-outline" aria-busy="true">
                Loading projects
              </p>
            ) : projects.length === 0 ? (
              <EmptyState text="No projects yet" />
            ) : (
              <ul class="link-list">
                {projects.map((project) => (
                  <li key={project.id}>
                    <a href={`/projects/${project.id}`} data-route aria-label={project.name}>
                      {project.name}
                    </a>
                    <span class="muted">{project.role}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <form class="inline-form" onSubmit={(event) => void create(event)} noValidate>
            <label class="field-label">
              Project name
              <input class="input" name="name" type="text" required aria-invalid={errors.name ? 'true' : undefined} />
            </label>
            {errors.name && <p class="field-error">{errors.name}</p>}
            <button class="pill" type="submit">
              New project
            </button>
          </form>
        </section>
        <section class="card">
          <h2>Settings</h2>
          <form class="stack" onSubmit={(event) => void saveSettings(event)} key={`${locale.number_format}${locale.time_zone}`}>
            <label class="field-label">
              Number format
              <select class="input" name="number_format" defaultValue={locale.number_format}>
                {NUMBER_FORMATS.map((format) => (
                  <option key={format} value={format}>
                    {format}
                  </option>
                ))}
              </select>
            </label>
            <label class="field-label">
              Time zone
              <select class="input" name="time_zone" defaultValue={locale.time_zone}>
                {TIME_ZONES.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </select>
            </label>
            <button class="pill" type="submit">
              Save settings
            </button>
          </form>
        </section>
      </main>
    </Shell>
  );
}

