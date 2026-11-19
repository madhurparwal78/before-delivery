import { useState } from 'react';
import { api, generalErrorCopy } from '../../api/client.ts';
import type { ProjectDetail } from '../../api/types.ts';
import { act, commit, useLoad } from '../../api/use-load.ts';
import type { Role } from '../../../shared/model.ts';
import type { Params } from '../../router.ts';
import { ErrorPage } from '../../shell/error-page.tsx';
import { Button, LinkButton } from '../../ui/button.tsx';
import { Checkbox, Select, TextField } from '../../ui/fields.tsx';
import { Link } from '../../ui/link.tsx';
import { Status, useAnnouncer } from '../../ui/live.tsx';
import { TableWrap } from '../../ui/table-wrap.tsx';
import './project.css';

const ROLES: { value: Role; label: string }[] = [
  { value: 'viewer', label: 'Viewer' },
  { value: 'explorer', label: 'Explorer' },
  { value: 'creator', label: 'Creator' },
];

const roleLabel = (role: Role) => ROLES.find((entry) => entry.value === role)?.label ?? role;

export function ProjectPage({ params }: { params: Params }) {
  const project = useLoad(() => api.get<ProjectDetail>(`/api/projects/${params.id}`), [params.id]);
  const [announcement, announce] = useAnnouncer();
  const [username, setUsername] = useState('');
  const [role, setRole] = useState<Role>('viewer');
  const [memberError, setMemberError] = useState<string | null>(null);

  if (project.error) return <ErrorPage error={project.error} />;
  const detail = project.data;
  if (!detail) return null;
  const creator = detail.role === 'creator';

  const addMember = () =>
    act(
      async () => {
        const added = await api.put<{ username: string; role: Role }>(
          `/api/projects/${detail.id}/members/${encodeURIComponent(username)}`,
          { role },
        );
        await project.reload();
        commit(() => {
          setUsername('');
          setMemberError(null);
          announce(`Member added: ${added.username} as ${added.role}.`);
        });
      },
      (caught) => {
        const message = generalErrorCopy(caught) ?? caught.fieldMessage('username');
        setMemberError(message);
        if (message) announce(message);
      },
    );

  const removeMember = (name: string) =>
    act(
      async () => {
        await api.delete(`/api/projects/${detail.id}/members/${encodeURIComponent(name)}`);
        await project.reload();
        commit(() => announce(`Removed ${name}.`));
      },
      (caught) => announce(generalErrorCopy(caught) ?? 'Something went wrong. Try again.'),
    );

  const setSchedule = (allowed: boolean) =>
    act(
      async () => {
        const next = await api.patch<ProjectDetail>(`/api/projects/${detail.id}`, { explorers_schedule: allowed });
        commit(() => project.set({ ...detail, explorers_schedule: next.explorers_schedule }));
      },
      (caught) => announce(generalErrorCopy(caught) ?? 'Something went wrong. Try again.'),
    );

  return (
    <div className="project">
      <div className="page-head">
        <h1>{detail.name}</h1>
        {creator ? (
          <LinkButton to={`/sources/new?project=${detail.id}`}>Upload a source</LinkButton>
        ) : null}
      </div>
      <Status name="Announcements" text={announcement} />
      <div className="project-columns">
        <section className="card-stack" aria-labelledby="members-heading">
          <h2 id="members-heading">Members</h2>
          <TableWrap>
            <table aria-label="Members">
              <thead>
                <tr>
                  <th scope="col">Username</th>
                  <th scope="col">Role</th>
                  {creator ? <th scope="col"><span className="sr-only">Actions</span></th> : null}
                </tr>
              </thead>
              <tbody>
                {detail.members.map((member) => (
                  <tr key={member.username}>
                    <th scope="row">{member.username}</th>
                    <td>{roleLabel(member.role)}</td>
                    {creator ? (
                      <td className="num">
                        <Button compact aria-label={`Remove ${member.username}`} onClick={() => void removeMember(member.username)}>
                          Remove
                        </Button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          {creator ? (
            <form
              className="card form-row"
              onSubmit={(event) => {
                event.preventDefault();
                void addMember();
              }}
            >
              <TextField label="Member username" value={username} onChange={setUsername} error={memberError} />
              <Select label="Role" value={role} onChange={(value) => setRole(value as Role)} options={ROLES} />
              <Button type="submit" variant="primary">
                Add member
              </Button>
            </form>
          ) : null}
          {creator ? (
            <div className="card">
              <Checkbox
                label="Explorers may schedule refreshes"
                checked={detail.explorers_schedule}
                onChange={(checked) => void setSchedule(checked)}
              />
            </div>
          ) : null}
        </section>
        <div className="card-stack">
          <section className="card" aria-labelledby="sources-heading">
            <h2 id="sources-heading">Sources</h2>
            {detail.sources.length === 0 ? <p className="muted">No sources yet.</p> : null}
            <ul className="link-list">
              {detail.sources.map((source) => (
                <li key={source.id}>
                  <Link to={`/sources/${source.id}`}>{source.name}</Link>
                </li>
              ))}
            </ul>
          </section>
          <section className="card" aria-labelledby="project-workbooks-heading">
            <h2 id="project-workbooks-heading">Workbooks</h2>
            {detail.workbooks.length === 0 ? <p className="muted">No workbooks yet.</p> : null}
            <ul className="link-list">
              {detail.workbooks.map((workbook) => (
                <li key={workbook.id}>
                  <Link to={`/workbooks/${workbook.id}`}>{workbook.name}</Link>
                  <span className="muted"> {workbook.state === 'published' ? 'Published' : 'Draft'}</span>
                  {workbook.certified_by ? <span className="muted">, certified by {workbook.certified_by}</span> : null}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
