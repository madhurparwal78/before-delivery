import { useCallback, useEffect, useState } from 'react';
import { MemberDto, SessionUser, StationDto } from '../../shared/api';
import { ROLE_LABELS } from '../../shared/roles';
import { MemberRole } from '../../shared/workbook';
import { ApiFailure, api } from '../lib/api';
import { notify } from '../lib/notices';
import { Dialog, FieldError } from '../components/shell';

const ZONES = [
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/New_York',
  'America/Winnipeg',
  'Europe/Berlin',
  'Europe/London',
  'Europe/Madrid',
  'Africa/Nairobi',
  'Asia/Kolkata',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Pacific/Auckland',
  'UTC',
];

const ROLES: MemberRole[] = ['viewer', 'technician', 'lead', 'data_manager'];

interface StationProps {
  user: SessionUser;
  onStationChanged: () => void;
}

export function StationScreen({ user, onStationChanged }: StationProps): JSX.Element {
  const [station, setStation] = useState<StationDto | null>(null);
  const [members, setMembers] = useState<MemberDto[]>([]);
  const [zone, setZone] = useState(user.timeZone);
  const [saving, setSaving] = useState(false);
  const [zoneError, setZoneError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(async () => {
    const [stationResult, membersResult] = await Promise.all([
      api<{ station: StationDto }>('/api/station'),
      api<{ members: MemberDto[] }>('/api/station/members'),
    ]);
    setStation(stationResult.station);
    setZone(stationResult.station.timeZone);
    setMembers(membersResult.members);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveZone = async () => {
    if (!ZONES.includes(zone)) {
      setZoneError('Pick a time zone from the list.');
      return;
    }
    setZoneError(null);
    setSaving(true);
    try {
      await api('/api/station', { method: 'PATCH', body: { timeZone: zone } });
      notify(`Time zone saved. TODAY() and cutoffs now use ${zone}.`);
      onStationChanged();
      await load();
    } catch (failure) {
      if (failure instanceof ApiFailure) setZoneError(failure.field('timeZone') ?? failure.text);
    } finally {
      setSaving(false);
    }
  };

  const changeRole = async (member: MemberDto, role: MemberRole) => {
    try {
      await api(`/api/station/members/${member.id}`, { method: 'PATCH', body: { role } });
      notify(`Role updated. It applies from ${member.name}'s next sync.`);
      await load();
    } catch (failure) {
      if (failure instanceof ApiFailure) notify(failure.text);
    }
  };

  const removeMember = async (member: MemberDto) => {
    try {
      await api(`/api/station/members/${member.id}`, { method: 'DELETE' });
      notify(`${member.name} was removed from the station.`);
      await load();
    } catch (failure) {
      if (failure instanceof ApiFailure) notify(failure.text);
    }
  };

  return (
    <main className="station-screen">
      <h1>Station settings</h1>
      <section className="paper-card">
        <label className="field">
          <span>Station time zone</span>
          <select aria-label="Station time zone" value={zone} onChange={(event) => setZone(event.target.value)}>
            {ZONES.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <FieldError text={zoneError} />
        <button type="button" className="primary-button" disabled={saving} onClick={saveZone}>
          {saving ? 'Saving…' : 'Save time zone'}
        </button>
        {station ? <p className="muted">{station.name}</p> : null}
      </section>

      <section className="paper-card">
        <button type="button" className="primary-button" onClick={() => setShowAdd(true)}>
          Add member
        </button>
        <table className="members-table">
          <caption className="visually-hidden">Members</caption>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Email</th>
              <th scope="col">Role</th>
              <th scope="col">Remove</th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <tr key={member.id}>
                <td>{member.name}</td>
                <td>{member.email}</td>
                <td>
                  <select
                    aria-label={`Role for ${member.name}`}
                    value={member.role}
                    onChange={(event) => void changeRole(member, event.target.value as MemberRole)}
                  >
                    {ROLES.map((role) => (
                      <option key={role} value={role}>
                        {ROLE_LABELS[role]}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <button type="button" className="ghost-button small" onClick={() => void removeMember(member)}>
                    Remove {member.name}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {showAdd ? (
        <AddMemberDialog
          onClose={() => setShowAdd(false)}
          onAdded={async (email) => {
            notify(`Member added. The invite email will be sent to ${email}.`);
            setShowAdd(false);
            await load();
          }}
        />
      ) : null}
    </main>
  );
}

function AddMemberDialog({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: (email: string) => Promise<void>;
}): JSX.Element {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<MemberRole>('technician');
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const submit = async () => {
    setPending(true);
    setFailure(null);
    try {
      await api('/api/station/members', { method: 'POST', body: { name, email, role } });
      await onAdded(email);
    } catch (problem) {
      if (problem instanceof ApiFailure) {
        setFailure(
          problem.code === 'member_exists'
            ? `${email} is already a member of this station.`
            : Object.values(problem.fields)[0] ?? problem.text,
        );
      }
      setPending(false);
    }
  };

  return (
    <Dialog title="Add member" onClose={onClose}>
      <label className="field">
        <span>Name</span>
        <input type="text" value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label className="field">
        <span>Email</span>
        <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
      </label>
      <label className="field">
        <span>Role</span>
        <select aria-label="Role" value={role} onChange={(event) => setRole(event.target.value as MemberRole)}>
          {ROLES.map((one) => (
            <option key={one} value={one}>
              {ROLE_LABELS[one]}
            </option>
          ))}
        </select>
      </label>
      <FieldError text={failure} />
      <div className="dialog-actions">
        <button type="button" className="primary-button" disabled={pending} onClick={submit}>
          {pending ? 'Sending…' : 'Send invite'}
        </button>
        <button type="button" className="ghost-button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}
