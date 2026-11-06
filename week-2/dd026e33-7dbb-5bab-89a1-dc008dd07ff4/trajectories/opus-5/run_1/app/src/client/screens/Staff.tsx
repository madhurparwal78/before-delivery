import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Member } from '../../shared/types';
import { revokeConfirmation, staffAccessLabel, timestampDateLabel } from '../copy';
import { api, errorCode } from '../lib/api';
import { useFirstLoad, useStatus, useSubmit } from '../lib/hooks';
import { Dialog } from '../components/Dialog';
import { StatusRegion } from '../components/Status';

const ROLE_TEXT: Record<string, string> = {
  concierge: 'Concierge',
  care_technician: 'Care technician',
  workshop_lead: 'Workshop lead',
  house_manager: 'House manager',
};

export function StaffScreen(): ReactNode {
  const status = useStatus();
  const [staff, setStaff] = useState<Member[]>([]);
  const [confirming, setConfirming] = useState<Member | null>(null);
  const [focusAfter, setFocusAfter] = useState<string | null>(null);
  const tableRef = useRef<HTMLTableElement | null>(null);

  const load = async (): Promise<void> => {
    const outcome = await api<{ staff: Member[] }>('/api/staff');
    if (outcome.kind === 'ok') setStaff(outcome.body.staff);
  };

  useFirstLoad(load);

  useEffect(() => {
    if (focusAfter === null) return;
    const button = tableRef.current?.querySelector<HTMLButtonElement>(
      `[data-access="${focusAfter}"]`,
    );
    button?.focus();
    setFocusAfter(null);
  }, [focusAfter, staff]);

  const submit = useSubmit<{ member: Member }>({
    status,
    pendingText: 'Saving...',
    onOk: (body) => {
      status.success(
        body.member.active
          ? `Access restored for ${body.member.name}.`
          : `Access revoked for ${body.member.name}.`,
      );
      setStaff((list) =>
        list.map((member) => (member.id === body.member.id ? body.member : member)),
      );
      setFocusAfter(body.member.id);
    },
    onError: (outcome) => {
      status.error(
        errorCode(outcome) === 'cannot_change_own_access'
          ? "You can't change your own access."
          : 'That could not be saved.',
      );
    },
  });

  const change = (member: Member, active: boolean): void => {
    void submit.run(() =>
      api<{ member: Member }>(`/api/staff/${member.id}`, { method: 'PATCH', body: { active } }),
    );
  };

  return (
    <div className="screen staff-screen">
      <h1>Staff access</h1>
      <table className="data-table" ref={tableRef}>
        <caption className="visually-hidden">Staff access</caption>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Email</th>
            <th scope="col">Role</th>
            <th scope="col">Last sign-in</th>
            <th scope="col">Access</th>
            <th scope="col">Change</th>
          </tr>
        </thead>
        <tbody>
          {staff.map((member) => (
            <tr key={member.id}>
              <th scope="row">{member.name}</th>
              <td>{member.email}</td>
              <td>{ROLE_TEXT[member.role] ?? member.role}</td>
              <td className="mono">
                {member.last_sign_in_at === null
                  ? '—'
                  : timestampDateLabel(member.last_sign_in_at)}
              </td>
              <td>{staffAccessLabel(member)}</td>
              <td className="row-actions">
                {member.active ? (
                  <button
                    type="button"
                    data-access={member.id}
                    onClick={() => setConfirming(member)}
                  >
                    {`Revoke access for ${member.name}`}
                  </button>
                ) : (
                  <button
                    type="button"
                    data-access={member.id}
                    onClick={() => change(member, true)}
                  >
                    {`Restore access for ${member.name}`}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {confirming === null ? null : (
        <Dialog
          name={`Revoke access for ${confirming.name}?`}
          alert
          initialFocus="last"
          onClose={() => setConfirming(null)}
        >
          <p>{revokeConfirmation(confirming.name)}</p>
          <div className="row-actions">
            <button
              type="button"
              className="primary"
              onClick={() => {
                const member = confirming;
                setConfirming(null);
                change(member, false);
              }}
            >
              Revoke access
            </button>
            <button type="button" onClick={() => setConfirming(null)}>
              Keep access
            </button>
          </div>
        </Dialog>
      )}
      <StatusRegion name="Access updates" status={status} />
    </div>
  );
}
