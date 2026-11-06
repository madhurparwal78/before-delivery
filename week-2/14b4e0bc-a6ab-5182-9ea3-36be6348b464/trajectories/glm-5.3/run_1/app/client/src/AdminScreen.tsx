import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AuditListResponse, AuditRow, ChainResponse, SessionUser } from '../../shared/api';
import { ROLES } from '../../shared/domain';
import type { Role } from '../../shared/domain';
import { apiGet, apiJson, errorMessage } from './api';
import { useAuth, useActivityStream } from './App';
import { COPY } from './hooks';
import { TopBar, useStatus } from './TopBar';
import { Dialog } from './ui';
import { formatViewerZone, chicagoInstantFromWallTime } from './time';

export function AdminScreen(): ReactNode {
  const { user } = useAuth();
  const status = useStatus(!!user);
  const navigate = useNavigate();
  const { events } = useActivityStream(!!user, null);
  const [users, setUsers] = useState<SessionUser[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [shown, setShown] = useState(0);
  const [olderAvailable, setOlderAvailable] = useState(true);
  const [held, setHeld] = useState<AuditRow[]>([]);
  const [chainStatus, setChainStatus] = useState('');
  const [pitStatus, setPitStatus] = useState('');
  const [businessTime, setBusinessTime] = useState('');
  const [dialog, setDialog] = useState<'add' | { reset: SessionUser } | null>({ reset: null } as never);
  const [activity, setActivity] = useState('');
  const [dialogStatus, setDialogStatus] = useState('');
  const [dialogErrors, setDialogErrors] = useState<Record<string, string>>({});
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState('Analyst');
  const [newPassword, setNewPassword] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const tableTopRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDialog(null);
  }, []);

  if (!user) return null;
  if (user.role !== 'Admin') {
    return (
      <div className="screen">
        <TopBar user={user} />
        <main>
          <h1 className="screen-heading">Admin only</h1>
          <p className="muted">You don&apos;t have permission to do that.</p>
        </main>
      </div>
    );
  }

  const loadUsers = async (): Promise<void> => {
    const res = await apiGet<{ users: SessionUser[] }>('/api/users');
    if (res.status === 200) setUsers(res.body.users);
  };

  const loadAudit = async (): Promise<void> => {
    const res = await apiGet<AuditListResponse>('/api/audit?limit=50');
    if (res.status === 200) {
      setAudit(res.body.rows);
      setAuditTotal(res.body.total);
      setShown(res.body.rows.length);
      setOlderAvailable(res.body.next_before_seq !== null);
    }
  };

  useEffect(() => {
    void loadUsers();
    void loadAudit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The Audit log table follows the activity stream (DP-05, DP-13).
  useEffect(() => {
    if (events.length === 0) return;
    const load = async (): Promise<void> => {
      await loadUsers();
      const latest = await apiGet<AuditListResponse>('/api/audit?limit=1');
      if (latest.status !== 200) return;
      const newestSeq = latest.body.rows[0]?.seq;
      if (newestSeq === undefined) return;
      const existing = new Set(audit.map((r) => r.seq));
      const heldExisting = new Set(held.map((r) => r.seq));
      if (existing.has(newestSeq) || heldExisting.has(newestSeq)) return;
      const res = await apiGet<AuditListResponse>(`/api/audit?limit=100&before_seq=${newestSeq + 1}`);
      if (res.status !== 200) return;
      const newRows = res.body.rows.filter((r) => r.seq > (audit[0]?.seq ?? 0));
      if (newRows.length === 0) return;
      const firstRowInView = tableTopRef.current ? firstRowTopInView() : true;
      if (firstRowInView && held.length === 0) {
        setAudit((prev) => [...newRows, ...prev]);
        setShown((n) => n + newRows.length);
        setAuditTotal((t) => t + newRows.length);
      } else {
        setHeld((prev) => [...prev, ...newRows]);
      }
    };
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events]);

  const firstRowTopInView = (): boolean => {
    const table = document.querySelector<HTMLTableElement>('[aria-label="Audit log"]');
    if (!table) return true;
    const first = table.querySelector('tr');
    if (!first) return true;
    const rect = first.getBoundingClientRect();
    return rect.top >= 0;
  };

  const showHeld = (): void => {
    const sorted = [...held].sort((a, b) => b.seq - a.seq);
    setAudit((prev) => [...sorted, ...prev]);
    setShown((n) => n + sorted.length);
    setAuditTotal((t) => t + sorted.length);
    setHeld([]);
    requestAnimationFrame(() => {
      const link = document.querySelector<HTMLAnchorElement>(`[data-seq-link="${sorted[0]?.seq}"]`);
      link?.focus();
    });
  };

  const loadOlder = async (): Promise<void> => {
    const oldest = audit[audit.length - 1]?.seq;
    if (oldest === undefined) return;
    const res = await apiGet<AuditListResponse>(`/api/audit?limit=50&before_seq=${oldest}`);
    if (res.status !== 200) return;
    setAudit((prev) => [...prev, ...res.body.rows]);
    setShown((n) => n + res.body.rows.length);
    setOlderAvailable(res.body.next_before_seq !== null);
  };

  const checkChain = async (): Promise<void> => {
    setChainStatus('Checking...');
    const res = await apiGet<ChainResponse>('/api/audit/chain');
    if (res.status === 200) {
      setChainStatus(
        res.body.intact
          ? `Audit chain intact through seq ${res.body.checked_through}.`
          : `Audit chain broken at seq ${res.body.first_broken_seq}.`
      );
    } else {
      setChainStatus(errorMessage(res.body, 'The chain check failed.'));
    }
  };

  const openPointInTime = async (): Promise<void> => {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(businessTime)) {
      setPitStatus('Use YYYY-MM-DDTHH:mm:ss in America/Chicago time.');
      return;
    }
    const instant = chicagoInstantFromWallTime(businessTime);
    if (!instant) {
      setPitStatus('Use YYYY-MM-DDTHH:mm:ss in America/Chicago time.');
      return;
    }
    setPitStatus('Resolving...');
    const res = await apiGet<{ total: number; as_of_seq?: number }>(`/api/search?as_of_time=${encodeURIComponent(instant)}`);
    if (res.status === 200 && res.body.as_of_seq !== undefined) {
      navigate(`/catalog?as_of=${res.body.as_of_seq}`);
    } else {
      setPitStatus(errorMessage(res.body, 'The point-in-time read failed.'));
    }
  };

  const changeRole = async (target: SessionUser, role: Role): Promise<void> => {
    const res = await apiJson<{ user: SessionUser }>('PATCH', `/api/users/${target.id}`, { role });
    if (res.status === 200) {
      setActivity(`Role updated: ${target.name} is now ${role}.`);
      await loadUsers();
    } else {
      setActivity(errorMessage(res.body, 'The role change was refused.'));
      await loadUsers();
    }
  };

  const submitAddUser = async (): Promise<void> => {
    setDialogStatus(COPY.saving);
    const res = await apiJson<{ user: SessionUser }>('POST', '/api/users', {
      name: newName,
      email: newEmail,
      role: newRole,
      password: newPassword,
    });
    if (res.status === 201) {
      setActivity(`User created: ${res.body.user.name}.`);
      setDialog(null);
      await loadUsers();
    } else if (res.status === 422) {
      const fields = (res.body as { error?: { fields?: Record<string, string> } }).error?.fields ?? {};
      setDialogErrors(fields);
      setDialogStatus(Object.values(fields)[0] ?? '');
    } else {
      setDialogStatus(errorMessage(res.body, 'The user was not created.'));
    }
  };

  const submitReset = async (): Promise<void> => {
    if (dialog === null || dialog === 'add') return;
    const target = (dialog as { reset: SessionUser }).reset;
    setDialogStatus(COPY.saving);
    const res = await apiJson<{ user: SessionUser; sessions_ended: number }>('PATCH', `/api/users/${target.id}`, {
      password: resetPassword,
    });
    if (res.status === 200) {
      setActivity(`Password reset: ${target.name} was signed out of ${res.body.sessions_ended} sessions.`);
      setDialog(null);
      await loadUsers();
    } else if (res.status === 422) {
      const fields = (res.body as { error?: { fields?: Record<string, string> } }).error?.fields ?? {};
      setDialogErrors(fields);
      setDialogStatus(Object.values(fields)[0] ?? '');
    } else {
      setDialogStatus(errorMessage(res.body, 'The password was not reset.'));
    }
  };

  return (
    <div className="screen">
      <TopBar user={user} />
      {status?.evidence === 'down' && (
        <div role="alert" className="banner">
          {COPY.evidenceOutage}
        </div>
      )}
      {status?.mail === 'down' && (
        <div role="alert" className="banner">
          {COPY.mailOutage}
        </div>
      )}
      <main data-motion={window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'reduced' : 'full'}>
        <h1 className="screen-heading">Admin</h1>
        <p role="status" aria-label="Activity" aria-live="polite" className="status">
          {activity}
        </p>

        <h2 className="section-heading">Users</h2>
        <table className="admin-table" aria-label="Users">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Email</th>
              <th scope="col">Role</th>
              <th scope="col">Reset password</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td data-label="Name">{u.name}</td>
                <td data-label="Email" className="mono">
                  {u.email}
                </td>
                <td data-label="Role">
                  <select
                    className="input role-select"
                    aria-label={`Role for ${u.name}`}
                    value={u.role}
                    disabled={u.id === user.id}
                    onChange={(e) => void changeRole(u, e.target.value as Role)}
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </td>
                <td data-label="Reset password">
                  {u.id !== user.id && (
                    <button type="button" className="btn" onClick={() => setDialog({ reset: u })}>
                      Reset password for {u.name}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="btn" onClick={() => setDialog('add')}>
          Add user
        </button>

        <h2 className="section-heading">Catalog as of</h2>
        <div role="group" aria-label="Catalog as of" className="pit-group">
          <label className="field">
            <span className="field-label">Business time</span>
            <input
              type="text"
              className="input mono"
              aria-label="Business time"
              placeholder="2026-09-30T23:59:59"
              value={businessTime}
              onChange={(e) => setBusinessTime(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void openPointInTime()}
            />
          </label>
          <button type="button" className="btn" onClick={() => void openPointInTime()}>
            Open catalog as of
          </button>
          <p role="status" aria-label="Point in time status" aria-live="polite" className="status">
            {pitStatus}
          </p>
        </div>

        <h2 className="section-heading">Audit chain</h2>
        <button type="button" className="btn" onClick={() => void checkChain()}>
          Check audit chain
        </button>
        <p role="status" aria-label="Chain check" aria-live="polite" className="status">
          {chainStatus}
        </p>

        <h2 className="section-heading">Audit log</h2>
        <p role="status" aria-live="polite" aria-label="Audit log updates" className="status">
          {held.length > 0 ? COPY.heldRows(held.length) : ''}
        </p>
        {held.length > 0 && (
          <button type="button" className="btn" onClick={showHeld}>
            {COPY.showHeldRows(held.length)}
          </button>
        )}
        <div ref={tableTopRef} />
        <table className="admin-table audit-table" aria-label="Audit log">
          <thead>
            <tr>
              <th scope="col">Seq</th>
              <th scope="col">When</th>
              <th scope="col">Actor</th>
              <th scope="col">Role</th>
              <th scope="col">Action</th>
              <th scope="col">Target</th>
              <th scope="col">Before</th>
              <th scope="col">After</th>
            </tr>
          </thead>
          <tbody>
            {audit.map((row) => (
              <tr key={row.seq}>
                <td data-label="Seq" className="mono">
                  <a
                    href={`/catalog?as_of=${row.seq}`}
                    data-seq-link={row.seq}
                    onClick={(e) => {
                      e.preventDefault();
                      navigate(`/catalog?as_of=${row.seq}`);
                    }}
                  >
                    {row.seq}
                  </a>
                </td>
                <td data-label="When" className="mono" data-at={row.at}>
                  {formatViewerZone(row.at)}
                </td>
                <td data-label="Actor">{row.actor.name}</td>
                <td data-label="Role">{row.actor_role}</td>
                <td data-label="Action">{row.action}</td>
                <td data-label="Target" className="mono">
                  {row.target.id}
                </td>
                <td data-label="Before" className="mono cell-json">
                  {JSON.stringify(row.before)}
                </td>
                <td data-label="After" className="mono cell-json">
                  {JSON.stringify(row.after)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p role="status" aria-label="Audit rows shown" aria-live="polite" className="status">
          {`Showing ${shown} of ${auditTotal + held.length}.`}
        </p>
        {olderAvailable && (
          <button type="button" className="btn" onClick={() => void loadOlder()}>
            Load older audit rows
          </button>
        )}
      </main>

      {dialog === 'add' && (
        <Dialog title="Add user" onClose={() => setDialog(null)}>
          <label className="field">
            <span className="field-label">Name</span>
            <input type="text" className="input" aria-label="Name" value={newName} onChange={(e) => setNewName(e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">Email</span>
            <input type="email" className="input" aria-label="Email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">Role</span>
            <select className="input" aria-label="Role" value={newRole} onChange={(e) => setNewRole(e.target.value)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Password</span>
            <input
              type="password"
              className="input"
              aria-label="Password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </label>
          <p role="status" aria-label="Dialog status" aria-live="polite" className="status dialog-status">
            {dialogStatus}
          </p>
          <div className="dialog-actions">
            <button type="button" className="btn primary" onClick={() => void submitAddUser()}>
              Create user
            </button>
            <button type="button" className="btn" onClick={() => setDialog(null)}>
              Cancel
            </button>
          </div>
        </Dialog>
      )}
      {dialog && dialog !== 'add' && (
        <Dialog title="Reset password" onClose={() => setDialog(null)}>
          <label className="field">
            <span className="field-label">New password</span>
            <input
              type="password"
              className="input"
              aria-label="New password"
              value={resetPassword}
              aria-invalid={dialogErrors.password !== undefined}
              aria-describedby={dialogErrors.password !== undefined ? 'reset-password-error' : undefined}
              onChange={(e) => setResetPassword(e.target.value)}
            />
            {dialogErrors.password !== undefined && (
              <span id="reset-password-error" className="field-error">
                {dialogErrors.password}
              </span>
            )}
          </label>
          <p role="status" aria-label="Dialog status" aria-live="polite" className="status dialog-status">
            {dialogStatus}
          </p>
          <div className="dialog-actions">
            <button type="button" className="btn primary" onClick={() => void submitReset()}>
              Reset password
            </button>
            <button type="button" className="btn" onClick={() => setDialog(null)}>
              Cancel
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
