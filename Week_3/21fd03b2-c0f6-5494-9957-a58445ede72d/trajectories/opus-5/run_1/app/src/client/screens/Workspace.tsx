import { useEffect, useState } from 'react';
import type { ProjectRow, WorkspaceResponse } from '../../shared/api.js';
import { emptyCopy, noticeCopy, pageCopy } from '../../shared/copy.js';
import { canEditScenes } from '../../shared/states.js';
import { ApiFault, api } from '../api.js';
import { AccountMenu } from '../components/AccountMenu.jsx';
import { LiveRegions } from '../components/LiveRegions.jsx';
import { Toolbar, ToolbarDivider, Wordmark } from '../components/Toolbar.jsx';
import { navigate } from '../nav.js';
import { announce } from '../regions.js';
import { useSession } from '../session.js';
import { NotFound } from './NotFound.jsx';

export function Workspace({ workspaceId }: { workspaceId: string }): JSX.Element {
  const { me } = useSession();
  const [workspace, setWorkspace] = useState<WorkspaceResponse | null>(null);
  const [projects, setProjects] = useState<ProjectRow[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});

  useEffect(() => {
    void api<WorkspaceResponse>(`/api/workspaces/${workspaceId}`)
      .then(setWorkspace)
      .catch((error: unknown) => {
        if (error instanceof ApiFault && error.status === 404) setMissing(true);
      });
    void api<{ projects: ProjectRow[] }>(`/api/workspaces/${workspaceId}/projects`)
      .then((response) => setProjects(response.projects))
      .catch(() => undefined);
  }, [workspaceId]);

  if (missing) return <NotFound />;

  const create = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setFields({});
    try {
      const response = await api<{ project: ProjectRow }>(
        `/api/workspaces/${workspaceId}/projects`,
        { method: 'POST', body: { name } },
      );
      announce('notices', noticeCopy.created(response.project.name));
      navigate(`/w/${workspaceId}/p/${response.project.id}`);
    } catch (error) {
      if (error instanceof ApiFault) setFields(error.fields);
    }
  };

  const role = workspace?.workspace.role ?? 'viewer';

  return (
    <div className="screen">
      <Toolbar>
        <a className="chip" data-chip href={`/w/${workspaceId}/settings`}>
          Settings
        </a>
        <a className="chip" data-chip href={`/w/${workspaceId}/activity`}>
          Activity
        </a>
        <ToolbarDivider />
        {me ? <AccountMenu me={me} workspaceId={workspaceId} /> : null}
        <Wordmark />
      </Toolbar>
      <div className="screen-body">
        <section className="panel" aria-label="Projects">
          <div className="panel-head">
            <h1 className="panel-title">Projects</h1>
            <span className="spacer" />
            {canEditScenes(role) ? (
              <button type="button" className="chip" onClick={() => setAdding((value) => !value)}>
                New project
              </button>
            ) : null}
          </div>
          <div className="panel-body">
            {workspace ? <h2>{workspace.workspace.name}</h2> : null}
            {adding ? (
              <form onSubmit={create} noValidate className="row">
                <div className="field" style={{ flex: 1 }}>
                  <label htmlFor="project-name">Project name</label>
                  <input
                    id="project-name"
                    type="text"
                    value={name}
                    aria-invalid={fields.name ? true : undefined}
                    onChange={(event) => setName(event.target.value)}
                  />
                  {fields.name ? <span className="field-error">{fields.name}</span> : null}
                </div>
                <button type="submit" className="chip on">
                  Create project
                </button>
              </form>
            ) : null}
            {projects === null ? <p className="empty">{pageCopy.loading}</p> : null}
            {projects !== null && projects.length === 0 ? (
              <p className="empty">{emptyCopy.projects}</p>
            ) : null}
            {projects !== null && projects.length > 0 ? (
              <ul className="list">
                {projects.map((project) => (
                  <li key={project.id}>
                    <a href={`/w/${workspaceId}/p/${project.id}`}>{project.name}</a>
                    <span className="muted num">
                      {project.sceneCount} scenes · {project.assetCount} assets
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </section>
      </div>
      <LiveRegions />
    </div>
  );
}
