import { useState, type FormEvent } from 'react';
import { ROLE_LABEL, ROLES, type Role } from '../../../shared/domain';
import { announce } from '../lib/announce';
import { ApiError, del, errorText, mutate, patch, post } from '../lib/api';
import { useResource } from '../lib/resource';
import { Modal } from '../components/Modal';
import { SplitBand } from '../components/Shell';
import { Banner, ErrorSummary, Field, Pill, Skeleton, type SummaryItem } from '../components/ui';

interface Member {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: 'Active' | 'Invited' | 'Removed';
}

function RoleDialog({ member, onClose, onDone }: { member: Member; onClose: () => void; onDone: () => void }) {
  const [role, setRole] = useState('');
  const [items, setItems] = useState<SummaryItem[]>([]);
  const [token, setToken] = useState(0);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (busy) return;
    if (!role) {
      setItems([{ field: 'role', message: 'Role is required.' }]);
      setToken((t) => t + 1);
      return;
    }
    setBusy(true);
    try {
      await mutate(
        () => patch<Member>(`/api/staff/${member.id}`, { role }),
        (updated) => {
          announce(`${updated.name} is now ${ROLE_LABEL[updated.role]}.`);
          onDone();
          onClose();
        },
      );
    } catch (error) {
      setItems([{ message: error instanceof ApiError ? error.message : 'Something went wrong. Try again.' }]);
      setToken((t) => t + 1);
      setBusy(false);
    }
  };
  const message = items.find((i) => i.field === 'role')?.message;
  return (
    <Modal label="Change role" onClose={onClose} returnFocus={() => document.getElementById(`change-${member.id}`)}>
      <h2 className="modal-title">Change role</h2>
      <p className="muted">{member.name}</p>
      <ErrorSummary items={items} token={token} fieldId={(f) => `role-${f}`} />
      <Field id="role-role" label="Role" error={message}>
        <select id="role-role" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">Choose a role</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>
      </Field>
      <div className="modal-actions">
        <Pill busy={busy} onClick={() => void submit()}>
          Save role
        </Pill>
        <Pill variant="outline" className="on-light" onClick={onClose}>
          Cancel
        </Pill>
      </div>
    </Modal>
  );
}

export function Staff() {
  const staff = useResource<{ staff: Member[] }>('/api/staff', ['staff']);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('nurse');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Member | null>(null);

  const invite = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await mutate(
        () => post('/api/staff/invitations', { email, name, role }),
        () => announce(`Invitation created for ${email}.`),
      );
      setName('');
      setEmail('');
      staff.reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = (member: Member) => {
    setError(null);
    mutate(
      () => del(`/api/staff/${member.id}`),
      () => {
        announce(`Access removed for ${member.name}.`);
        document.getElementById('screen-heading')?.focus();
      },
    )
      .then(() => staff.reload())
      .catch((e: unknown) => setError(errorText(e)));
  };

  const members = staff.data?.staff;
  return (
    <>
      <SplitBand title="Staff">
        <p className="band-count">
          <span className="band-number">{members?.filter((m) => m.status === 'Active').length ?? 0}</span> active staff
        </p>
      </SplitBand>
      <form className="invite-form tint-plain" onSubmit={(e) => void invite(e)} noValidate>
        <h2 className="section-title">Invite someone</h2>
        <div className="form-row">
          <Field id="invite-name" label="Name">
            <input id="invite-name" type="text" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field id="invite-email" label="Email">
            <input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field id="invite-role" label="Role">
            <select id="invite-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Banner message={error} />
        <Pill type="submit" busy={busy}>
          Send invitation
        </Pill>
      </form>
      {!members ? (
        <Skeleton rows={4} />
      ) : (
        <table aria-label="Staff" className="data-table" role="table">
          <thead role="rowgroup">
            <tr role="row">
              <th role="columnheader">Name</th>
              <th role="columnheader">Email</th>
              <th role="columnheader">Role</th>
              <th role="columnheader">Status</th>
              <th role="columnheader" />
            </tr>
          </thead>
          <tbody role="rowgroup">
            {members.map((m) => (
              <tr key={m.id} role="row" aria-label={`${m.name}, ${ROLE_LABEL[m.role]}, ${m.status}`}>
                <td role="cell" data-label="Name">
                  {m.name}
                </td>
                <td role="cell" data-label="Email">
                  {m.email}
                </td>
                <td role="cell" data-label="Role">
                  {ROLE_LABEL[m.role]}
                </td>
                <td role="cell" data-label="Status">
                  {m.status}
                </td>
                <td role="cell">
                  {m.status !== 'Removed' && (
                    <div className="row-actions">
                      <Pill id={`change-${m.id}`} variant="outline" className="on-light" aria-label={`Change role, ${m.name}`} onClick={() => setEditing(m)}>
                        Change role
                      </Pill>
                      <Pill variant="outline" className="on-light" aria-label={`Remove access, ${m.name}`} onClick={() => remove(m)}>
                        Remove access
                      </Pill>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {editing && <RoleDialog member={editing} onClose={() => setEditing(null)} onDone={staff.reload} />}
    </>
  );
}
