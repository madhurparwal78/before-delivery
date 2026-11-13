import { useEffect, useState } from 'react';
import type { AssetRow, ProjectRow, SceneRow } from '../../shared/api.js';
import { emptyCopy, fieldCopy, noticeCopy, pageCopy } from '../../shared/copy.js';
import { SCENE_TEMPLATES, type SceneTemplate } from '../../shared/scene.js';
import { canEditScenes, type WorkspaceRole } from '../../shared/states.js';
import { ApiFault, api } from '../api.js';
import { AccountMenu } from '../components/AccountMenu.jsx';
import { Dialog } from '../components/Dialog.jsx';
import { LiveRegions } from '../components/LiveRegions.jsx';
import { Toolbar, ToolbarDivider, Wordmark } from '../components/Toolbar.jsx';
import { navigate } from '../nav.js';
import { announce } from '../regions.js';
import { useSession } from '../session.js';
import { NotFound } from './NotFound.jsx';

const STATE_LABELS: Record<SceneRow['status'], string> = {
  draft: 'Draft',
  checkpointed: 'Checkpointed',
  published: 'Published',
  unpublished: 'Unpublished',
};

const TEMPLATE_LABELS: Record<SceneTemplate, string> = {
  blank: 'Blank',
  ramp: 'Ramp',
  pendulum: 'Pendulum',
  launcher: 'Launcher',
};

interface ProjectResponse {
  project: ProjectRow;
  scenes: SceneRow[];
  assets: AssetRow[];
}

export function Project({
  workspaceId,
  projectId,
}: {
  workspaceId: string;
  projectId: string;
}): JSX.Element {
  const { me } = useSession();
  const [data, setData] = useState<ProjectResponse | null>(null);
  const [missing, setMissing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [template, setTemplate] = useState<SceneTemplate>('ramp');
  const [fields, setFields] = useState<Record<string, string>>({});

  useEffect(() => {
    void api<ProjectResponse>(`/api/projects/${projectId}`)
      .then(setData)
      .catch((error: unknown) => {
        if (error instanceof ApiFault && error.status === 404) setMissing(true);
      });
  }, [projectId]);

  if (missing) return <NotFound />;

  const role: WorkspaceRole =
    me?.workspaces.find((workspace) => workspace.id === workspaceId)?.role ?? 'viewer';

  const createScene = async (): Promise<void> => {
    setFields({});
    try {
      const response = await api<{ scene: SceneRow }>(`/api/projects/${projectId}/scenes`, {
        method: 'POST',
        body: { name, template },
      });
      announce('notices', noticeCopy.created(response.scene.name));
      navigate(`/w/${workspaceId}/s/${response.scene.id}`);
    } catch (error) {
      if (error instanceof ApiFault) setFields(error.fields);
      else setFields({ name: fieldCopy.name });
    }
  };

  return (
    <div className="screen">
      <Toolbar>
        <a className="chip" data-chip href={`/w/${workspaceId}`}>
          Projects
        </a>
        <a className="chip" data-chip href={`/w/${workspaceId}/activity`}>
          Activity
        </a>
        <ToolbarDivider />
        {me ? <AccountMenu me={me} workspaceId={workspaceId} /> : null}
        <Wordmark />
      </Toolbar>
      <div className="screen-body">
        <section className="panel" aria-label="Scenes">
          <div className="panel-head">
            <h1 className="panel-title">Scenes</h1>
            <span className="spacer" />
            {canEditScenes(role) ? (
              <button type="button" className="chip" onClick={() => setCreating(true)}>
                New scene
              </button>
            ) : null}
          </div>
          <div className="panel-body">
            {data ? <h2>{data.project.name}</h2> : <p className="empty">{pageCopy.loading}</p>}
            {data && data.scenes.length === 0 ? (
              <p className="empty">{emptyCopy.scenes}</p>
            ) : null}
            {data && data.scenes.length > 0 ? (
              <ul className="list">
                {data.scenes.map((scene) => (
                  <li key={scene.id}>
                    <a href={`/w/${workspaceId}/s/${scene.id}`}>{scene.name}</a>
                    <span className="state-chip">{STATE_LABELS[scene.status]}</span>
                    <span className="muted num">rev {scene.revision}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </section>
      </div>
      {creating ? (
        <Dialog title="New scene" onClose={() => setCreating(false)}>
          <div className="field">
            <label htmlFor="new-scene-name">Scene name</label>
            <input
              id="new-scene-name"
              type="text"
              value={name}
              aria-invalid={fields.name ? true : undefined}
              onChange={(event) => setName(event.target.value)}
            />
            {fields.name ? <span className="field-error">{fields.name}</span> : null}
          </div>
          <div role="radiogroup" aria-label="Template">
            {SCENE_TEMPLATES.map((candidate) => (
              <label className="radio-row" key={candidate}>
                <input
                  type="radio"
                  name="template"
                  checked={template === candidate}
                  onChange={() => setTemplate(candidate)}
                />
                {TEMPLATE_LABELS[candidate]}
              </label>
            ))}
          </div>
          <div className="dialog-actions">
            <button type="button" className="chip" onClick={() => setCreating(false)}>
              Cancel
            </button>
            <button type="button" className="chip on" onClick={() => void createScene()}>
              Create scene
            </button>
          </div>
        </Dialog>
      ) : null}
      <LiveRegions />
    </div>
  );
}
