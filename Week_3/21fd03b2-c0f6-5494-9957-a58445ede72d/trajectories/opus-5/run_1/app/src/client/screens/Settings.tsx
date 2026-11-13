import { useEffect, useState } from 'react';
import type { InviteRow, MemberRow, WorkspaceResponse } from '../../shared/api.js';
import { noticeCopy, pageCopy } from '../../shared/copy.js';
import { ROLE_LABELS, canAdminister, type InviteRole } from '../../shared/states.js';
import { ApiFault, api } from '../api.js';
import { AccountMenu } from '../components/AccountMenu.jsx';
import { LiveRegions } from '../components/LiveRegions.jsx';
import { Toolbar, ToolbarDivider, Wordmark } from '../components/Toolbar.jsx';
import { announce } from '../regions.js';
import { useSession } from '../session.js';
import { NotFound } from './NotFound.jsx';

export function Settings({ workspaceId }: { workspaceId: string }): JSX.Element {
  const { me } = useSession();
  const [data, setData] = useState<WorkspaceResponse | null>(null);
  const [missing, setMissing] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<InviteRole>('editor');
  const [fields, setFields] = useState<Record<string, string>>({});

  const load = (): void => {
    void api<WorkspaceResponse>(`/api/workspaces/${workspaceId}`)
      .then(setData)
      .catch((error: unknown) => {
        if (error instanceof ApiFault && error.status === 404) setMissing(true);
      });
  };

  useEffect(load, [workspaceId]);

  if (missing) return <NotFound />;

  const invite = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setFields({});
    announce('notices', noticeCopy.invitePending);
    try {
      const response = await api<{ delivery: 'sent' | 'queued' }>(
        `/api/workspaces/${workspaceId}/invites`,
        { method: 'POST', body: { email, role } },
      );
      announce(
        'notices',
        response.delivery === 'sent'
          ? noticeCopy.inviteSent(email)
          : noticeCopy.inviteQueued(email),
      );
      setEmail('');
      load();
    } catch (error) {
      if (error instanceof ApiFault) {
        setFields(error.fields);
        announce('notices', error.message);
      }
    }
  };

  const revoke = async (pending: InviteRow): Promise<void> => {
    try {
      await api(`/api/workspaces/${workspaceId}/invites/${pending.id}`, { method: 'DELETE' });
      announce('notices', noticeCopy.inviteRevoked(pending.email));
      load();
    } catch (error) {
      if (error instanceof ApiFault) announce('notices', error.message);
    }
  };

  const changeRole = async (member: MemberRow, next: InviteRole): Promise<void> => {
    try {
      await api(`/api/workspaces/${workspaceId}/members/${member.userId}`, {
        method: 'PATCH',
        body: { role: next },
      });
      announce('notices', noticeCopy.roleChanged(member.displayName, ROLE_LABELS[next]));
      load();
    } catch (error) {
      if (error instanceof ApiFault) announce('notices', error.message);
    }
  };

  const owner = data ? canAdminister(data.workspace.role) : false;

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
        <section className="panel">
          <div className="panel-head">
            <h1 className="panel-title">Members</h1>
          </div>
          <div className="panel-body">
            {!data ? <p className="empty">{pageCopy.loading}</p> : null}
            {data ? (
              <table className="stacked" aria-label="Members">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Role</th>
                  </tr>
                </thead>
                <tbody>
                  {data.members.map((member) => (
                    <tr key={member.userId}>
                      <td>{member.displayName}</td>
                      <td className="muted">{member.email}</td>
                      <td>
                        {member.role === 'owner' || !owner ? (
                          ROLE_LABELS[member.role]
                        ) : (
                          <select
                            aria-label={`Role for ${member.displayName}`}
                            value={member.role}
                            onChange={(event) =>
                              void changeRole(member, event.target.value as InviteRole)
                            }
                          >
                            <option value="editor">Editor</option>
                            <option value="viewer">Viewer</option>
                          </select>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </div>
        </section>

        {owner ? (
          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">Invite a co-tutor</h2>
            </div>
            <div className="panel-body">
              <form onSubmit={invite} noValidate className="row">
                <div className="field" style={{ flex: 1 }}>
                  <label htmlFor="invite-email">Invite email</label>
                  <input
                    id="invite-email"
                    type="text"
                    value={email}
                    aria-invalid={fields.email ? true : undefined}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                  {fields.email ? <span className="field-error">{fields.email}</span> : null}
                </div>
                <div className="field">
                  <label htmlFor="invite-role">Invite role</label>
                  <select
                    id="invite-role"
                    aria-label="Invite role"
                    value={role}
                    onChange={(event) => setRole(event.target.value as InviteRole)}
                  >
                    <option value="editor">Editor</option>
                    <option value="viewer">Viewer</option>
                  </select>
                  {fields.role ? <span className="field-error">{fields.role}</span> : null}
                </div>
                <button type="submit" className="chip on">
                  Send invite
                </button>
              </form>
            </div>
          </section>
        ) : null}

        {owner && data ? (
          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">Pending invites</h2>
            </div>
            <div className="panel-body">
              <table className="stacked" aria-label="Pending invites">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Expires</th>
                    <th> </th>
                  </tr>
                </thead>
                <tbody>
                  {data.invites.map((pending) => (
                    <tr key={pending.id}>
                      <td>{pending.email}</td>
                      <td>{ROLE_LABELS[pending.role]}</td>
                      <td className="muted num">{pending.expiresAt.slice(0, 10)}</td>
                      <td>
                        <button
                          type="button"
                          className="chip"
                          aria-label={`Revoke invite to ${pending.email}`}
                          onClick={() => void revoke(pending)}
                        >
                          Revoke
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
      </div>
      <LiveRegions />
    </div>
  );
}
