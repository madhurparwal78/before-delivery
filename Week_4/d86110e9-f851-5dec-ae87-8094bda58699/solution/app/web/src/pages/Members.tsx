import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, ApiFailure, w } from '../api';
import { useTitle } from '../router';
import { useShell } from '../shell';
import { Button, EmptyState, Problem, Skeleton, useAccess } from '../ui';
import type { MembersView, WorkspaceInfo } from '../types';
import '../build/styles/site.css';

export function Members({ workspace }: { workspace: WorkspaceInfo }) {
  useTitle('Members');
  const { say, raise, epoch } = useShell();
  const { locked } = useAccess();
  const [view, setView] = useState<MembersView | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'editor' | 'viewer'>('viewer');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ message: string } | null>(null);

  const load = useCallback(async () => setView(await api.get<MembersView>(w(workspace.id, '/members'))), [workspace.id]);
  useEffect(() => {
    void load();
  }, [load, epoch]);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    api.post(w(workspace.id, '/invites'), { email, role })
      .then(async () => {
        say(`Invite sent to ${email}`);
        setEmail('');
        await load();
      })
      .catch((error: unknown) => {
        if (!(error instanceof ApiFailure)) throw error;
        if (error.status === 503) raise('Email is unavailable. The invite was not sent.');
        else setProblem({ message: error.message });
      })
      .finally(() => setBusy(false));
  };

  return (
    <div>
      <div className="page-head">
        <h1>Members</h1>
      </div>
      {view === null ? (
        <Skeleton rows={4} />
      ) : (
        <div className="members-layout">
          <div className="data-wrap">
            <table aria-label="Members" className="data-table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Email</th>
                  <th scope="col">Role</th>
                </tr>
              </thead>
              <tbody>
                {view.members.map((member) => (
                  <tr key={member.user_id}>
                    <td>{member.name}</td>
                    <td>{member.email}</td>
                    <td>{member.role}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="side-card">
            <h2>Pending invites</h2>
            <ul aria-label="Pending invites" className="pending-list">
              {view.invites.map((invite) => (
                <li key={invite.id}>
                  <span>{invite.email}</span>
                  <span className="row-meta mono-label">{invite.role}</span>
                </li>
              ))}
            </ul>
            {view.invites.length === 0 ? <EmptyState>No invites are waiting.</EmptyState> : null}
            <h2>Invite someone</h2>
            <form onSubmit={submit} noValidate>
              <Problem message={problem?.message ?? null} field="invitee" />
              <div className="field">
                <label htmlFor="field-invitee">Invitee email</label>
                <input id="field-invitee" type="email" value={email} onChange={(event) => setEmail(event.target.value)} {...locked('owner')} />
              </div>
              <div className="field">
                <label htmlFor="field-role">Role</label>
                <select id="field-role" value={role} onChange={(event) => setRole(event.target.value as 'editor' | 'viewer')} {...locked('owner')}>
                  <option value="editor">editor</option>
                  <option value="viewer">viewer</option>
                </select>
              </div>
              <Button type="submit" busy={busy} {...locked('owner')}>Send invite</Button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
