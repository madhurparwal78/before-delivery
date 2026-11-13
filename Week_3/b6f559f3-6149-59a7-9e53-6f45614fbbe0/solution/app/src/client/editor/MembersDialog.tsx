import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { MESSAGES, inviteSent } from '../../shared/messages';
import type { InviteInfo, MemberInfo } from '../../shared/types';
import { api, ApiError } from '../api';
import { Dialog } from '../ui/Dialog';
import { Notice } from './controls';
import { useEditorSelector, useEditorStore } from './EditorProvider';

interface MembersResponse {
  members: MemberInfo[];
  invites: InviteInfo[];
}

function inviteRow(invite: InviteInfo): string {
  const state = invite.status === 'queued' ? MESSAGES.inviteQueuedRow : invite.status === 'expired' ? 'Invite expired' : MESSAGES.inviteSentRow;
  return `${invite.email} · ${invite.role} · ${state}`;
}

function InviteDialog({ onClose, onSent }: { onClose: () => void; onSent: (email: string) => void }) {
  const projectId = useEditorSelector((e) => e.projectId);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'Editor' | 'Viewer'>('Editor');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const guard = useRef(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await api.post(`/api/projects/${projectId}/invites`, { email: email.trim(), role });
      onSent(email.trim());
      setEmail('');
    } catch (failure) {
      if (!(failure instanceof ApiError)) throw failure;
      setError(failure.message);
    } finally {
      guard.current = false;
      setBusy(false);
    }
  };

  return (
    <Dialog name="Invite people" onClose={onClose}>
      <div className="dialog-head">
        <h2>Invite people</h2>
      </div>
      <form className="stack" onSubmit={(event) => void submit(event)}>
        <label className="field-label">
          Email
          <input type="email" aria-label="Email" value={email} data-autofocus autoComplete="off" onChange={(event) => setEmail(event.target.value)} />
        </label>
        <div role="radiogroup" aria-label="Role" className="radio-row">
          {(['Editor', 'Viewer'] as const).map((value) => (
            <label key={value} className="radio-choice">
              <input type="radio" name="invite-role" value={value} checked={role === value} onChange={() => setRole(value)} />
              {value}
            </label>
          ))}
        </div>
        <Notice message={error} />
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy}>
            {busy ? MESSAGES.sending : 'Send invite'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function MembersDialog({ onClose }: { onClose: () => void }) {
  const store = useEditorStore();
  const projectId = useEditorSelector((e) => e.projectId);
  const role = useEditorSelector((e) => e.role);
  const membersTick = useEditorSelector((e) => e.membersTick);
  const [data, setData] = useState<MembersResponse | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [inviting, setInviting] = useState(false);
  const owner = role === 'Owner';

  const load = useCallback(async () => {
    setData(await api.get<MembersResponse>(`/api/projects/${projectId}/members`));
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load, membersTick]);

  const remove = async (member: MemberInfo): Promise<void> => {
    setError(undefined);
    try {
      await api.delete(`/api/projects/${projectId}/members/${member.personId}`);
      setStatus(`Removed ${member.name}.`);
      await load();
      await store.actions.refresh();
    } catch (failure) {
      if (!(failure instanceof ApiError)) throw failure;
      setError(failure.message);
    }
  };

  return (
    <>
      <Dialog name="Members" onClose={onClose}>
        <div className="dialog-head">
          <h2>Members</h2>
          <button type="button" className="btn" disabled={!owner} aria-describedby={owner ? undefined : 'member-hint'} title={owner ? undefined : MESSAGES.memberRefusal} onClick={() => setInviting(true)}>
            Invite people
          </button>
        </div>
        {!owner && (
          <span id="member-hint" className="sr-only">
            {MESSAGES.memberRefusal}
          </span>
        )}
        <div role="status" aria-label="Members status" className="status-line">
          {status}
        </div>
        <Notice message={error} />
        <ul role="list" aria-label="Members" className="plain-list">
          {data?.members.map((member) => (
            <li key={member.personId} className="member-row">
              <span>
                {member.name} · {member.role}
              </span>
              {owner && member.role !== 'Owner' && (
                <button type="button" className="btn btn-compact" aria-label={`Remove ${member.name}`} onClick={() => void remove(member)}>
                  Remove
                </button>
              )}
            </li>
          ))}
          {data?.invites
            .filter((invite) => invite.status !== 'accepted')
            .map((invite) => (
              <li key={invite.id} className="member-row">
                <span>{inviteRow(invite)}</span>
              </li>
            ))}
        </ul>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </Dialog>
      {inviting && (
        <InviteDialog
          onClose={() => setInviting(false)}
          onSent={(email) => {
            setStatus(inviteSent(email));
            void load();
          }}
        />
      )}
    </>
  );
}
