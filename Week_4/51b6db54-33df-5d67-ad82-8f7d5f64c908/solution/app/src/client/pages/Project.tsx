import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { api, refusal, upload, type ApiResult } from '../api';
import { followJob, jobEnded, jobText } from '../jobs';
import { navigate } from '../router';
import { localeOf } from '../session';
import { clearAlerts, Dialog, EmptyState, notify, raise } from '../ui';
import { formatDate } from '../../shared/format';
import type { Config, JobState } from '../../shared/types';
import { Shell } from './Shell';
import { useRequireMe } from './Projects';

interface Member {
  id: number;
  name: string;
  email: string;
  role: 'owner' | 'editor' | 'reviewer';
}

interface ProjectData {
  id: number;
  name: string;
  role: Member['role'];
  members: Member[];
  sprites: { id: number; name: string }[];
  imports: { id: number; file_name: string; sprite: number }[];
}

interface Invite {
  id: number;
  email: string;
  role: string;
  state: string;
  expires_at: string;
}

interface Link {
  id: number;
  sprite: number;
  label: string;
  url: string;
  state: string;
  expires_at: string | null;
}

interface ExportRow {
  id: number;
  label: string;
  files: { name: string }[];
}

const titleCase = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1);

function FieldError({ text }: { text?: string }): JSX.Element | null {
  return text ? <p class="field-error">{text}</p> : null;
}

function NewSprite({ project, onClose, onCreated }: { project: number; onClose: () => void; onCreated: () => void }): JSX.Element {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const submit = async (event: Event): Promise<void> => {
    event.preventDefault();
    const form = new FormData(event.currentTarget as HTMLFormElement);
    const result = await api('POST', `/api/projects/${project}/sprites`, { name: form.get('name'), width: Number(form.get('width')), height: Number(form.get('height')) });
    if (!result.ok) {
      const { message, fields } = refusal(result);
      setErrors(fields);
      raise(message);
      return;
    }
    clearAlerts();
    onCreated();
    onClose();
  };
  return (
    <Dialog label="New sprite" onClose={onClose}>
      <form class="stack" onSubmit={(event) => void submit(event)} noValidate>
        <h2>New sprite</h2>
        <label class="field-label">
          Sprite name
          <input class="input" name="name" type="text" required data-autofocus />
        </label>
        <FieldError text={errors.name} />
        <label class="field-label">
          Width
          <input class="input" name="width" type="number" defaultValue="16" min="1" />
        </label>
        <FieldError text={errors.width} />
        <label class="field-label">
          Height
          <input class="input" name="height" type="number" defaultValue="16" min="1" />
        </label>
        <FieldError text={errors.height} />
        <div class="row">
          <button class="pill" type="submit">
            Create sprite
          </button>
          <button class="pill ghost" type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function Project({ id }: { id: number }): JSX.Element {
  const me = useRequireMe();
  const locale = localeOf(me);
  const [project, setProject] = useState<ProjectData | null>(null);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [exportRows, setExportRows] = useState<ExportRow[]>([]);
  const [newSprite, setNewSprite] = useState(false);
  const [job, setJob] = useState<{ id: number; state: JobState } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const picker = useRef<HTMLInputElement>(null);

  const role = project?.role;
  const isOwner = role === 'owner';
  const canEdit = role === 'owner' || role === 'editor';

  const load = async (): Promise<void> => {
    const result = await api<ProjectData>('GET', `/api/projects/${id}`);
    if (!result.ok) return navigate('/projects', true);
    setProject(result.body);
    const [exportsResult, invitesResult, linksResult] = await Promise.all([
      api<{ exports: ExportRow[] }>('GET', `/api/projects/${id}/exports`),
      result.body.role === 'owner' ? api<{ invites: Invite[] }>('GET', `/api/projects/${id}/invites`) : Promise.resolve(null),
      result.body.role === 'owner' ? api<{ links: Link[] }>('GET', `/api/projects/${id}/links`) : Promise.resolve(null),
    ]);
    if (exportsResult.ok) setExportRows(exportsResult.body.exports);
    if (invitesResult?.ok) setInvites(invitesResult.body.invites);
    if (linksResult?.ok) setLinks(linksResult.body.links);
  };
  useEffect(() => {
    if (me) void load();
  }, [me?.id, id]);

  const fail = (result: ApiResult): void => {
    const { message, fields } = refusal(result);
    setErrors(fields);
    raise(message);
  };

  const changeRole = async (member: Member, next: string): Promise<void> => {
    const result = await api('PATCH', `/api/projects/${id}/members/${member.id}`, { role: next });
    if (!result.ok) fail(result);
    await load();
  };

  const removeMember = async (member: Member): Promise<void> => {
    const result = await api('DELETE', `/api/projects/${id}/members/${member.id}`);
    if (!result.ok) fail(result);
    await load();
  };

  const invite = async (event: Event): Promise<void> => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    clearAlerts();
    notify('Sending invite…');
    const result = await api('POST', `/api/projects/${id}/invites`, { email: data.get('email'), role: data.get('role') });
    if (!result.ok) {
      notify('');
      return fail(result);
    }
    setErrors({});
    notify(`Invite created for ${String(data.get('email'))}`);
    form.reset();
    await load();
  };

  const revokeInvite = async (invite: Invite): Promise<void> => {
    const result = await api('DELETE', `/api/invites/${invite.id}`);
    if (!result.ok) fail(result);
    await load();
  };

  const createLink = async (event: Event): Promise<void> => {
    event.preventDefault();
    const data = new FormData(event.currentTarget as HTMLFormElement);
    const hours = String(data.get('hours')).trim();
    const sprite = Number(data.get('sprite'));
    clearAlerts();
    let expires: string | null = null;
    if (hours !== '') {
      const count = Number(hours);
      if (!Number.isInteger(count) || count < 1 || count > 720) {
        setErrors({ hours: 'Use 1 to 720 hours' });
        raise('Use 1 to 720 hours');
        return;
      }
      const config = await api<Config>('GET', '/api/config');
      expires = new Date(Date.parse(config.body.now) + count * 3600_000).toISOString();
    }
    notify('Creating link…');
    const result = await api('POST', `/api/sprites/${sprite}/links`, { label: data.get('label'), expires_at: expires });
    if (!result.ok) {
      notify('');
      return fail(result);
    }
    setErrors({});
    notify('Link created');
    await load();
  };

  const linkAction = async (link: Link, action: 'revoke' | 'regenerate'): Promise<void> => {
    notify(action === 'revoke' ? 'Revoking link…' : 'Regenerating link…');
    const result = await (action === 'revoke' ? api('DELETE', `/api/links/${link.id}`) : api('POST', `/api/links/${link.id}/regenerate`));
    if (!result.ok) {
      notify('');
      return fail(result);
    }
    notify(action === 'revoke' ? 'Link revoked' : 'Link regenerated');
    await load();
  };

  const importImage = async (file: File): Promise<void> => {
    clearAlerts();
    notify('Importing…');
    const result = await upload<{ file_name: string }>(`/api/projects/${id}/imports`, file);
    if (picker.current) picker.current.value = '';
    if (!result.ok) {
      notify('');
      return fail(result);
    }
    notify(`Imported ${result.body.file_name}`);
    await load();
  };

  const exportProject = async (): Promise<void> => {
    clearAlerts();
    const result = await api<{ job: number }>('POST', `/api/projects/${id}/exports`, { scale: 1, padding: 0, extrude: 0, label: 'Project export' });
    if (!result.ok) return fail(result);
    const jobId = result.body.job;
    setJob({ id: jobId, state: { state: 'queued', done: 0, total: 0, files: [] } });
    followJob(jobId, (state) => {
      setJob({ id: jobId, state });
      if (jobEnded(state)) void load();
    });
  };

  const cancelJob = async (): Promise<void> => {
    if (!job) return;
    const result = await api('POST', `/api/jobs/${job.id}/cancel`);
    if (!result.ok) fail(result);
  };

  if (!project) {
    return (
      <Shell>
        <main class="narrow">
          <p class="loading-outline" aria-busy="true">
            Loading project
          </p>
        </main>
      </Shell>
    );
  }
  return (
    <Shell>
      <main class="page-columns">
        <h1 class="page-title wide">{project.name}</h1>
        <section class="card">
          <h2>Sprites</h2>
          {project.sprites.length === 0 ? (
            <EmptyState text="No sprites yet" variant={1} />
          ) : (
            <ul class="link-list">
              {project.sprites.map((sprite) => (
                <li key={sprite.id}>
                  <a href={`/projects/${id}/sprites/${sprite.id}`} data-route>
                    {sprite.name}
                  </a>
                </li>
              ))}
            </ul>
          )}
          {canEdit && (
            <div class="row">
              <button class="pill" type="button" onClick={() => setNewSprite(true)}>
                New sprite
              </button>
              <input ref={picker} hidden type="file" aria-label="Image file" accept="image/png,image/gif" onChange={(e) => { const file = (e.currentTarget as HTMLInputElement).files?.[0]; if (file) void importImage(file); }} />
              <button class="pill" type="button" onClick={() => { const file = picker.current?.files?.[0]; if (file) void importImage(file); else picker.current?.click(); }}>
                Import image
              </button>
            </div>
          )}
          {project.imports.length > 0 && (
            <ul class="link-list">
              {project.imports.map((item) => (
                <li key={item.id}>
                  <a href={`/api/imports/${item.id}/original`} download={item.file_name} aria-label={`Download original ${item.file_name}`}>
                    Download original {item.file_name}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section class="card">
          <h2>Members</h2>
          <table class="members" role="table" aria-label="Members">
            <thead role="rowgroup">
              <tr role="row">
                <th role="columnheader" scope="col">Name</th>
                <th role="columnheader" scope="col">Role</th>
                {isOwner && <th role="columnheader" scope="col">Access</th>}
              </tr>
            </thead>
            <tbody role="rowgroup">
              {project.members.map((member) => (
                <tr role="row" key={member.id} aria-label={member.name}>
                  <td role="cell">
                    {member.name}
                    <span class="muted block">{member.email}</span>
                  </td>
                  <td role="cell">
                    {isOwner ? (
                      member.role === 'owner' ? (
                        <select class="input" aria-label={`Role for ${member.name}`} disabled>
                          <option>Owner</option>
                        </select>
                      ) : (
                        <select class="input" aria-label={`Role for ${member.name}`} value={member.role} onChange={(e) => void changeRole(member, (e.currentTarget as HTMLSelectElement).value)}>
                          <option value="editor">Editor</option>
                          <option value="reviewer">Reviewer</option>
                        </select>
                      )
                    ) : (
                      titleCase(member.role)
                    )}
                  </td>
                  {isOwner && (
                    <td role="cell">
                      {member.role !== 'owner' && (
                        <button class="pill small" type="button" aria-label={`Remove ${member.name}`} onClick={() => void removeMember(member)}>
                          Remove
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        {isOwner && (
          <section class="card">
            <h2>Invites</h2>
            <form class="stack" onSubmit={(event) => void invite(event)} noValidate>
              <label class="field-label">
                Invite email
                <input class="input" name="email" type="email" required />
              </label>
              <FieldError text={errors.email} />
              <label class="field-label">
                Invite role
                <select class="input" name="role">
                  <option value="editor">Editor</option>
                  <option value="reviewer">Reviewer</option>
                </select>
              </label>
              <FieldError text={errors.role} />
              <button class="pill" type="submit">
                Invite
              </button>
            </form>
            {invites.length === 0 ? (
              <EmptyState text="No invites yet" variant={2} />
            ) : (
              <table aria-label="Invites">
                <thead>
                  <tr>
                    <th scope="col">Email</th>
                    <th scope="col">Role</th>
                    <th scope="col">State</th>
                    <th scope="col">Ends</th>
                  </tr>
                </thead>
                <tbody>
                  {invites.map((item) => (
                    <tr key={item.id} aria-label={item.email}>
                      <td>{item.email}</td>
                      <td>{titleCase(item.role)}</td>
                      <td class="state">{item.state}</td>
                      <td>
                        {item.state === 'pending' ? (
                          <button class="pill small" type="button" aria-label="Revoke invite" onClick={() => void revokeInvite(item)}>
                            Revoke
                          </button>
                        ) : (
                          formatDate(item.expires_at, locale)
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}
        {isOwner && (
          <section class="card">
            <h2>Read-only links</h2>
            <form class="stack" onSubmit={(event) => void createLink(event)} noValidate>
              <label class="field-label">
                Link sprite
                <select class="input" name="sprite">
                  {project.sprites.map((sprite) => (
                    <option key={sprite.id} value={sprite.id}>
                      {sprite.name}
                    </option>
                  ))}
                </select>
              </label>
              <label class="field-label">
                Link label
                <input class="input" name="label" type="text" required />
              </label>
              <FieldError text={errors.label} />
              <label class="field-label">
                Link hours
                <input class="input" name="hours" type="number" defaultValue="24" />
              </label>
              <FieldError text={errors.hours} />
              <FieldError text={errors.expires_at} />
              <button class="pill" type="submit">
                Create link
              </button>
            </form>
            {links.length === 0 ? (
              <EmptyState text="No links yet" />
            ) : (
              <table aria-label="Read-only links">
                <thead>
                  <tr>
                    <th scope="col">Link</th>
                    <th scope="col">State</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {links.map((link) => (
                    <tr key={link.id} aria-label={link.label}>
                      <td>
                        {link.label}
                        <span class="muted block url">{link.url}</span>
                      </td>
                      <td class="state">{link.state}</td>
                      <td>
                        {link.state === 'active' && (
                          <div class="row">
                            <button class="pill small" type="button" aria-label="Revoke link" onClick={() => void linkAction(link, 'revoke')}>
                              Revoke
                            </button>
                            <button class="pill small" type="button" aria-label="Regenerate link" onClick={() => void linkAction(link, 'regenerate')}>
                              Regenerate
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}
        <section class="card">
          <h2>Exports</h2>
          {canEdit && (
            <button class="pill" type="button" onClick={() => void exportProject()} disabled={job !== null && !jobEnded(job.state)}>
              Export project
            </button>
          )}
          {job && (
            <div class="job">
              <div role="status" aria-label="Job progress">
                {jobText(job.state, locale)}
              </div>
              {!jobEnded(job.state) && (
                <button class="pill small" type="button" onClick={() => void cancelJob()}>
                  Cancel job
                </button>
              )}
            </div>
          )}
          {exportRows.length === 0 ? (
            <EmptyState text="No exports yet" variant={1} />
          ) : (
            <table aria-label="Exports">
              <thead>
                <tr>
                  <th scope="col">Export</th>
                  <th scope="col">Files</th>
                </tr>
              </thead>
              <tbody>
                {exportRows.map((row) => (
                  <tr key={row.id} aria-label={row.label || `Export ${row.id}`}>
                    <td>{row.label || `Export ${row.id}`}</td>
                    <td>
                      <ul class="link-list">
                        {row.files.map((file) => (
                          <li key={file.name}>
                            <a href={`/api/exports/${row.id}/files/${file.name}`} download={file.name} aria-label={`Download ${file.name}`}>
                              {file.name}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </main>
      {newSprite && <NewSprite project={id} onClose={() => setNewSprite(false)} onCreated={() => void load()} />}
    </Shell>
  );
}
