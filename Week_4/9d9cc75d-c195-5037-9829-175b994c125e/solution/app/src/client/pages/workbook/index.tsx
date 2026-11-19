import { useState } from 'react';
import { api, generalErrorCopy } from '../../api/client.ts';
import type { ProjectRef, WorkbookDetail } from '../../api/types.ts';
import { act, commit, useLoad } from '../../api/use-load.ts';
import type { SheetShape } from '../../../shared/model.ts';
import { navigate } from '../../router.ts';
import type { Params } from '../../router.ts';
import { ErrorPage } from '../../shell/error-page.tsx';
import { creatorProjects, useSession } from '../../shell/session.tsx';
import { Button } from '../../ui/button.tsx';
import { Link } from '../../ui/link.tsx';
import { Status } from '../../ui/live.tsx';
import { NewDashboardDialog } from './new-dashboard-dialog.tsx';
import { PublishDialog } from './publish-dialog.tsx';
import './workbook.css';

const CONFLICT = 'This workbook changed since you opened it. Reload and publish again.';

function blankSheet(name: string): SheetShape {
  return {
    name,
    rows: [],
    columns: [],
    color: null,
    size: null,
    label: [],
    detail: [],
    filters: [],
    chart: 'automatic',
    totals: false,
    reference_lines: [],
    trend: false,
    sort: {},
  };
}

function freeSheetName(taken: readonly string[]): string {
  let n = taken.length + 1;
  while (taken.includes(`Sheet ${n}`)) n += 1;
  return `Sheet ${n}`;
}

export function WorkbookPage({ params }: { params: Params }) {
  const { me } = useSession();
  const loaded = useLoad(() => api.get<WorkbookDetail>(`/api/workbooks/${params.id}`), [params.id]);
  const [dialog, setDialog] = useState<'dashboard' | 'publish' | null>(null);
  const [publishState, setPublishState] = useState('');
  const [notice, setNotice] = useState('');

  if (loaded.error) return <ErrorPage error={loaded.error} />;
  const workbook = loaded.data;
  if (!workbook) return null;
  const creator = me?.projects.some((project) => project.id === workbook.project && project.role === 'creator') ?? false;
  const header = { 'If-Match': String(workbook.version) };

  const newSheet = () =>
    act(
      async () => {
        const made = await api.post<{ id: string }>(
          `/api/workbooks/${workbook.id}/sheets`,
          blankSheet(freeSheetName(workbook.sheets.map((sheet) => sheet.name))),
          header,
        );
        navigate(`/workbooks/${workbook.id}/sheets/${made.id}`);
      },
      (caught) => setNotice(generalErrorCopy(caught) ?? caught.fieldMessage() ?? 'Something went wrong. Try again.'),
    );

  const publish = (project: ProjectRef) => {
    setDialog(null);
    setPublishState('Publishing...');
    return act(
      async () => {
        await api.post(`/api/workbooks/${workbook.id}/publish`, { project: project.id }, header);
        await loaded.reload();
        commit(() => setPublishState(`Published to ${project.name}.`));
      },
      (caught) => {
        setPublishState(
          caught.status === 409 ? CONFLICT : (generalErrorCopy(caught) ?? caught.fieldMessage() ?? 'Something went wrong. Try again.'),
        );
        void loaded.reload();
      },
    );
  };

  const certify = () =>
    act(
      async () => {
        await api.post(`/api/workbooks/${workbook.id}/certify`);
        await loaded.reload();
      },
      (caught) => setNotice(generalErrorCopy(caught) ?? 'Something went wrong. Try again.'),
    );

  return (
    <div className="workbook">
      <div className="workbook-head">
        <h1>{workbook.name}</h1>
        {creator ? (
          <div className="workbook-actions">
            <Button onClick={() => void newSheet()}>New sheet</Button>
            <Button onClick={() => setDialog('dashboard')}>New dashboard</Button>
            <Button variant="primary" onClick={() => setDialog('publish')}>
              Publish
            </Button>
            <Button variant="primary" disabled={workbook.state !== 'published'} onClick={() => void certify()}>
              Certify
            </Button>
          </div>
        ) : null}
      </div>
      <div className="workbook-state">
        <span className={workbook.state === 'published' ? 'chip chip-published' : 'chip'}>
          {workbook.state === 'published' ? 'Published' : 'Draft'}
        </span>
        <Status name="Certified" text={workbook.certified_by ? `Certified by ${workbook.certified_by}` : ''} />
        <Status name="Publish state" text={publishState} />
      </div>
      <Status name="Workbook notice" text={notice} banner />
      <div className="workbook-lists">
        <section className="card" aria-labelledby="workbook-sheets">
          <h2 id="workbook-sheets">Sheets</h2>
          {workbook.sheets.length === 0 ? <p className="muted">No sheets yet.</p> : null}
          <ul className="workbook-links">
            {workbook.sheets.map((sheet) => (
              <li key={sheet.id}>
                <Link to={`/workbooks/${workbook.id}/sheets/${sheet.id}`}>{sheet.name}</Link>
              </li>
            ))}
          </ul>
        </section>
        <section className="card" aria-labelledby="workbook-dashboards">
          <h2 id="workbook-dashboards">Dashboards</h2>
          {workbook.dashboards.length === 0 ? <p className="muted">No dashboards yet.</p> : null}
          <ul className="workbook-links">
            {workbook.dashboards.map((dashboard) => (
              <li key={dashboard.id}>
                <Link to={`/dashboards/${dashboard.id}`}>{dashboard.name}</Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
      {dialog === 'dashboard' ? (
        <NewDashboardDialog
          workbook={workbook.id}
          version={workbook.version}
          sheets={workbook.sheets}
          onCreated={async () => {
            await loaded.reload();
            commit(() => setDialog(null));
          }}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === 'publish' ? (
        <PublishDialog
          projects={creatorProjects(me)}
          current={workbook.project}
          onPublish={(project) => void publish(project)}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </div>
  );
}
