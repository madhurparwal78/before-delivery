import { useRef, useState, type JSX } from 'react';
import { api } from '../api';
import { useLiveResource } from '../live';
import { AlertBanner, Dialog, InlineAlert, Pill, useAnnounce, type SummaryItem } from '../ui';
import { ForbiddenCard, ROLE_LABELS, SplitBand, useApp, type Role } from '../app';
import { messageOf } from './today';

type StaffMember = {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: 'Active' | 'Invited' | 'Removed';
};

export function StaffScreen(): JSX.Element {
  const { session } = useApp();
  const announce = useAnnounce();
  const staff = useLiveResource<{ staff: StaffMember[] }>('/api/staff', ['staff']);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('nurse');
  const [formError, setFormError] = useState<string | null>(null);
  const [alert, setAlert] = useState<string | null>(null);
  const [changing, setChanging] = useState<StaffMember | null>(null);
  const [busy, setBusy] = useState(false);
  const heading = useRef<HTMLHeadingElement | null>(null);

  if (session && session.role !== 'manager') return <ForbiddenCard />;

  const members = staff.data?.staff ?? [];
  const activeCount = members.filter((member) => member.status === 'Active').length;

  const invite = async (): Promise<void> => {
    setBusy(true);
    try {
      await api('POST', '/api/staff/invitations', { name, email, role });
      announce(`Invitation created for ${email}.`);
      setName('');
      setEmail('');
      setFormError(null);
      staff.reload();
    } catch (error) {
      setFormError(messageOf(error));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (member: StaffMember): Promise<void> => {
    try {
      await api('DELETE', `/api/staff/${member.id}`);
      announce(`Access removed for ${member.name}.`);
      staff.reload();
      heading.current?.focus();
      setAlert(null);
    } catch (error) {
      setAlert(messageOf(error));
    }
  };

  return (
    <div className="screen">
      <SplitBand
        headline={
          <h1 tabIndex={-1} ref={heading}>
            Staff
          </h1>
        }
        right={<p className="band-count">{`${activeCount} active staff`}</p>}
      />
      <div className="screen-body">
        <AlertBanner message={alert} />
        <div className="form-row">
          <div className="field">
            <label htmlFor="staff-name">Name</label>
            <input
              id="staff-name"
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="staff-email">Email</label>
            <input
              id="staff-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="staff-role">Role</label>
            <select
              id="staff-role"
              value={role}
              onChange={(event) => setRole(event.target.value as Role)}
            >
              <option value="front-desk">Front desk</option>
              <option value="nurse">Nurse</option>
              <option value="vet">Vet</option>
              <option value="manager">Manager</option>
            </select>
          </div>
          <Pill busy={busy} onClick={() => void invite()}>
            Send invitation
          </Pill>
          <InlineAlert message={formError} />
        </div>

        <table className="data-table" aria-label="Staff">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Email</th>
              <th scope="col">Role</th>
              <th scope="col">Status</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <tr
                key={member.id}
                aria-label={`${member.name}, ${ROLE_LABELS[member.role]}, ${member.status}`}
              >
                <td>{member.name}</td>
                <td>{member.email}</td>
                <td>{ROLE_LABELS[member.role]}</td>
                <td>{member.status}</td>
                <td>
                  {member.status !== 'Removed' ? (
                    <>
                      <Pill
                        variant="secondary"
                        name={`Change role, ${member.name}`}
                        onClick={() => setChanging(member)}
                      >
                        Change role
                      </Pill>
                      <Pill
                        variant="secondary"
                        name={`Remove access, ${member.name}`}
                        onClick={() => void remove(member)}
                      >
                        Remove access
                      </Pill>
                    </>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {changing ? (
        <ChangeRoleDialog
          member={changing}
          onClose={() => setChanging(null)}
          onChanged={(member, nextRole) => {
            setChanging(null);
            staff.reload();
            announce(`${member.name} is now ${ROLE_LABELS[nextRole]}.`);
          }}
        />
      ) : null}
    </div>
  );
}

function ChangeRoleDialog({
  member,
  onClose,
  onChanged,
}: {
  member: StaffMember;
  onClose: () => void;
  onChanged: (member: StaffMember, role: Role) => void;
}): JSX.Element {
  const [role, setRole] = useState('');
  const [summary, setSummary] = useState<SummaryItem[]>([]);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      name="Change role"
      onClose={onClose}
      summary={summary}
      onSummaryLink={() => document.getElementById('change-role')?.focus()}
    >
      <div className="field">
        <label htmlFor="change-role">Role</label>
        <select
          id="change-role"
          value={role}
          aria-describedby={summary.length > 0 ? 'change-role-error' : undefined}
          onChange={(event) => setRole(event.target.value)}
        >
          <option value="">Choose a role</option>
          <option value="front-desk">Front desk</option>
          <option value="nurse">Nurse</option>
          <option value="vet">Vet</option>
          <option value="manager">Manager</option>
        </select>
        {summary.length > 0 ? (
          <p className="field-error" id="change-role-error">
            {summary[0].message}
          </p>
        ) : null}
      </div>
      <div className="dialog-actions">
        <Pill
          busy={busy}
          onClick={async () => {
            if (!role) {
              setSummary([{ field: 'Role', message: 'Role is required.' }]);
              return;
            }
            setBusy(true);
            try {
              await api('PATCH', `/api/staff/${member.id}`, { role });
              onChanged(member, role as Role);
            } catch (error) {
              setSummary([{ field: 'Role', message: messageOf(error) }]);
            } finally {
              setBusy(false);
            }
          }}
        >
          Save role
        </Pill>
        <Pill variant="secondary" onClick={onClose}>
          Cancel
        </Pill>
      </div>
    </Dialog>
  );
}
