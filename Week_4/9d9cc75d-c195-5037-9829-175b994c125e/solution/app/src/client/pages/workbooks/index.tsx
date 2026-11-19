import { useState } from 'react';
import { api, generalErrorCopy } from '../../api/client.ts';
import type { ProjectDetail, WorkbookDetail, WorkbookListItem } from '../../api/types.ts';
import { act, useLoad } from '../../api/use-load.ts';
import { ErrorPage } from '../../shell/error-page.tsx';
import { creatorProjects, useSession } from '../../shell/session.tsx';
import { Button } from '../../ui/button.tsx';
import { Dialog } from '../../ui/dialog.tsx';
import { EmptyState } from '../../ui/empty-state.tsx';
import { Select, TextField } from '../../ui/fields.tsx';
import { Link } from '../../ui/link.tsx';
import { Status } from '../../ui/live.tsx';
import { navigate } from '../../router.ts';
import { WorkbookThumbnail } from './thumbnail.tsx';
import './workbooks.css';

function NewWorkbookDialog({ onClose }: { onClose: () => void }) {
  const { me } = useSession();
  const projects = creatorProjects(me);
  const [name, setName] = useState('');
  const [project, setProject] = useState(projects[0]?.id ?? '');
  const [source, setSource] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [state, setState] = useState('');
  const sources = useLoad(async () => (project ? (await api.get<ProjectDetail>(`/api/projects/${project}`)).sources : []), [project]);
  const choices = sources.data ?? [];
  const chosen = choices.some((entry) => entry.id === source) ? source : (choices[0]?.id ?? '');

  const create = () =>
    act(
      async () => {
        const made = await api.post<WorkbookDetail>(`/api/projects/${project}/workbooks`, { name, source: chosen });
        navigate(`/workbooks/${made.id}`);
      },
      (caught) => {
        setErrors(caught.fields);
        setState(generalErrorCopy(caught) ?? caught.fieldMessage() ?? '');
      },
    );

  return (
    <Dialog name="New workbook" onClose={onClose}>
      <TextField label="Workbook name" value={name} onChange={setName} error={errors.name} />
      <Select
        label="Project"
        value={project}
        onChange={setProject}
        options={projects.map((entry) => ({ value: entry.id, label: entry.name }))}
        error={errors.project}
      />
      <Select
        label="Source"
        value={chosen}
        onChange={setSource}
        options={choices.map((entry) => ({ value: entry.id, label: entry.name }))}
        error={errors.source}
      />
      <Status name="New workbook state" text={state} />
      <div className="dialog-actions">
        <Button variant="primary" onClick={() => void create()}>
          Create workbook
        </Button>
      </div>
    </Dialog>
  );
}

function NewProjectDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => Promise<void> }) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = () =>
    act(
      async () => {
        const made = await api.post<{ id: string }>('/api/projects', { name });
        await onCreated(made.id);
      },
      (caught) => setError(generalErrorCopy(caught) ?? caught.fieldMessage('name')),
    );

  return (
    <Dialog name="New project" onClose={onClose}>
      <TextField label="Project name" value={name} onChange={setName} error={error} />
      <div className="dialog-actions">
        <Button variant="primary" onClick={() => void create()}>
          Create project
        </Button>
      </div>
    </Dialog>
  );
}

function WorkbookCard({ workbook, projectName }: { workbook: WorkbookListItem; projectName: string }) {
  return (
    <li className="card workbook-card">
      <WorkbookThumbnail workbook={workbook.id} />
      <div className="workbook-body">
        <h2>
          <Link to={`/workbooks/${workbook.id}`}>{workbook.name}</Link>
        </h2>
        <p className="muted">{projectName}</p>
        <p className="workbook-marks">
          <span className={workbook.state === 'published' ? 'chip chip-published' : 'chip'}>
            {workbook.state === 'published' ? 'Published' : 'Draft'}
          </span>
          {workbook.certified_by ? <span className="chip chip-certified">Certified</span> : null}
        </p>
      </div>
    </li>
  );
}

export function WorkbooksPage() {
  const { me, refresh } = useSession();
  const workbooks = useLoad(() => api.get<WorkbookListItem[]>('/api/workbooks'), []);
  const [dialog, setDialog] = useState<'workbook' | 'project' | null>(null);
  const creator = creatorProjects(me).length > 0;

  if (workbooks.error) return <ErrorPage error={workbooks.error} />;
  const nameOf = (project: string) => me?.projects.find((entry) => entry.id === project)?.name ?? project;

  return (
    <div className="workbooks">
      <div className="page-head">
        <h1>Workbooks</h1>
        <div className="page-actions">
          <Button onClick={() => setDialog('project')}>New project</Button>
          {creator ? (
            <Button variant="primary" onClick={() => setDialog('workbook')}>
              New workbook
            </Button>
          ) : null}
        </div>
      </div>
      {me && me.projects.length > 0 ? (
        <nav className="project-strip" aria-label="Projects">
          {me.projects.map((project) => (
            <Link key={project.id} to={`/projects/${project.id}`} className="chip chip-link">
              {project.name}
            </Link>
          ))}
        </nav>
      ) : null}
      {workbooks.data?.length === 0 ? <EmptyState headline="No workbooks yet." /> : null}
      <ul className="workbook-list">
        {workbooks.data?.map((workbook) => <WorkbookCard key={workbook.id} workbook={workbook} projectName={nameOf(workbook.project)} />)}
      </ul>
      {dialog === 'workbook' ? <NewWorkbookDialog onClose={() => setDialog(null)} /> : null}
      {dialog === 'project' ? (
        <NewProjectDialog
          onClose={() => setDialog(null)}
          onCreated={async (id) => {
            await refresh();
            navigate(`/projects/${id}`);
          }}
        />
      ) : null}
    </div>
  );
}
