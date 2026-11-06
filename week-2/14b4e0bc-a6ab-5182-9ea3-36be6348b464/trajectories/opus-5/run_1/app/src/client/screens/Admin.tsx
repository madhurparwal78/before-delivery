import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ROLES, type Role } from '../../shared/domain.ts';
import { businessWallTimeToInstant, formatViewerZoneTime } from '../../shared/businessTime.ts';
import { type AuditRow, type SearchBody, type SessionUser, api } from '../lib/api.ts';
import { COPY } from '../lib/copy.ts';
import { useAppState } from '../lib/hooks.ts';
import { store } from '../lib/store.ts';

const PAGE_SIZE = 50;

interface AdminHistoryState {
  adminOldestSeq?: number;
  followedSeq?: number;
}

function UsersTable(): ReactNode {
  const state = useAppState();
  const [users, setUsers] = useState<SessionUser[]>([]);
  const load = useCallback(async () => {
    const result = await api<{ users: SessionUser[] }>('GET', '/api/users');
    if (result.ok) setUsers(result.data.users);
  }, []);

  useEffect(() => {
    void load();
    store.usersListener = () => void load();
    return () => {
      store.usersListener = null;
    };
  }, [load]);

  return (
    <>
      <table role="table" aria-label="Users" className="users-table">
        <thead role="rowgroup">
          <tr role="row">
            <th role="columnheader" scope="col">
              Name
            </th>
            <th role="columnheader" scope="col">
              Email
            </th>
            <th role="columnheader" scope="col">
              Role
            </th>
            <th role="columnheader" scope="col">
              Reset password
            </th>
          </tr>
        </thead>
        <tbody role="rowgroup">
          {users.map((user) => (
            <tr role="row" key={user.id}>
              <td role="cell">
                <span className="cell-label">Name</span>
                {user.name}
              </td>
              <td role="cell">
                <span className="cell-label">Email</span>
                <span className="mono">{user.email}</span>
              </td>
              <td role="cell">
                <span className="cell-label">Role</span>
                <select
                  aria-label={`Role for ${user.name}`}
                  data-focus-key={`role-${user.id}`}
                  value={user.role}
                  onChange={(event) =>
                    void store.changeRole(user.id, user.name, event.target.value as Role)
                  }
                >
                  {ROLES.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              </td>
              <td role="cell">
                <span className="cell-label">Reset password</span>
                {user.id === state.session?.id ? null : (
                  <button
                    type="button"
                    data-focus-key={`reset-password:${user.id}`}
                    onClick={() => store.openResetPasswordDialog(user.id, user.name)}
                  >
                    {`Reset password for ${user.name}`}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" data-focus-key="add-user" onClick={() => store.openAddUserDialog()}>
        Add user
      </button>
    </>
  );
}

function CatalogAsOf(): ReactNode {
  const state = useAppState();
  const [wallTime, setWallTime] = useState('');

  const open = async (): Promise<void> => {
    const business = businessWallTimeToInstant(wallTime);
    if (business === null) {
      store.setPointInTimeStatus(COPY.pointInTimeMalformed);
      return;
    }
    store.setPointInTimeStatus(COPY.resolving);
    const result = await api<SearchBody>(
      'GET',
      `/api/search?as_of_time=${encodeURIComponent(business.rfc3339)}`,
    );
    if (!result.ok) {
      store.setPointInTimeStatus(result.error.message);
      return;
    }
    store.setPointInTimeStatus('');
    store.navigate(`/catalog?as_of=${result.data.as_of_seq ?? 0}`);
  };

  return (
    <div role="group" aria-label="Catalog as of" className="as-of">
      <label htmlFor="business-time">Business time</label>
      <input
        id="business-time"
        type="text"
        value={wallTime}
        onChange={(event) => setWallTime(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            void open();
          }
        }}
      />
      <button type="button" onClick={() => void open()}>
        Open catalog as of
      </button>
      <p role="status" aria-label="Point in time status">
        {state.pointInTimeStatus}
      </p>
    </div>
  );
}

function ChainCheck(): ReactNode {
  const [status, setStatus] = useState('');
  return (
    <div className="chain-check">
      <button
        type="button"
        onClick={async () => {
          setStatus(COPY.checking);
          const result = await api<{
            intact: boolean;
            checked_through: number;
            first_broken_seq: number | null;
          }>('GET', '/api/audit/chain');
          if (!result.ok) {
            setStatus(result.error.message);
            return;
          }
          setStatus(
            result.data.intact
              ? COPY.chainIntact(result.data.checked_through)
              : COPY.chainBroken(result.data.first_broken_seq ?? 0),
          );
        }}
      >
        Check audit chain
      </button>
      <p role="status" aria-label="Chain check">
        {status}
      </p>
    </div>
  );
}

function AuditLog(): ReactNode {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [held, setHeld] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [shownStatus, setShownStatus] = useState('');
  const [updates, setUpdates] = useState('');
  const [hasOlder, setHasOlder] = useState(false);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const tableRef = useRef<HTMLTableElement | null>(null);
  const firstRowTop = useRef<{ seq: number; offset: number } | null>(null);
  const heldAnnounced = useRef(false);
  const rowsRef = useRef<AuditRow[]>([]);
  const heldRef = useRef<AuditRow[]>([]);
  const totalRef = useRef(0);

  rowsRef.current = rows;
  heldRef.current = held;
  totalRef.current = total;

  const firstRow = (): HTMLElement | null =>
    tableRef.current?.querySelector<HTMLElement>('tbody tr') ?? null;

  const loadNewest = useCallback(async (downToSeq: number | null) => {
    const limit = downToSeq === null ? PAGE_SIZE : Math.max(PAGE_SIZE, 500);
    const result = await api<{ rows: AuditRow[]; total: number; next_before_seq: number | null }>(
      'GET',
      `/api/audit?limit=${limit}`,
    );
    if (!result.ok) return;
    const loaded =
      downToSeq === null
        ? result.data.rows
        : result.data.rows.filter((row) => row.seq >= downToSeq);
    setRows(loaded);
    setTotal(result.data.total);
    setNextBefore(loaded.length === 0 ? null : loaded[loaded.length - 1].seq);
    setHasOlder(loaded.length > 0 && loaded[loaded.length - 1].seq > 1);
    setShownStatus(COPY.rowsShown(loaded.length, result.data.total));
  }, []);

  const fetchRow = useCallback(async (seq: number): Promise<AuditRow | null> => {
    const result = await api<{ rows: AuditRow[] }>('GET', `/api/audit?limit=1&before_seq=${seq + 1}`);
    if (!result.ok) return null;
    return result.data.rows[0] ?? null;
  }, []);

  useEffect(() => {
    const historyState = (window.history.state ?? {}) as AdminHistoryState;
    void loadNewest(historyState.adminOldestSeq ?? null).then(() => {
      if (historyState.followedSeq !== undefined) {
        const link = document.querySelector<HTMLElement>(
          `[data-focus-key="seq:${historyState.followedSeq}"]`,
        );
        link?.scrollIntoView({ block: 'center' });
        link?.focus();
      }
    });
  }, [loadNewest]);

  useEffect(() => {
    store.auditListener = (seq: number) => {
      void (async () => {
        const row = await fetchRow(seq);
        if (row === null) return;
        if (rowsRef.current.some((shown) => shown.seq === seq)) return;
        if (heldRef.current.some((shown) => shown.seq === seq)) return;
        const top = firstRow()?.getBoundingClientRect().top ?? null;
        const scrolledPast = top !== null && top < 0;
        if (scrolledPast || heldRef.current.length > 0) {
          setHeld((current) => [row, ...current].sort((a, b) => b.seq - a.seq));
          return;
        }
        setRows((current) => [row, ...current]);
        setTotal((current) => {
          const next = current + 1;
          setShownStatus(COPY.rowsShown(rowsRef.current.length + 1, next));
          return next;
        });
      })();
    };
    return () => {
      store.auditListener = null;
    };
  }, [fetchRow]);

  useEffect(() => {
    if (held.length === 0) {
      heldAnnounced.current = false;
      return;
    }
    if (!heldAnnounced.current) {
      heldAnnounced.current = true;
      setUpdates(COPY.newAuditRows(held.length));
    }
  }, [held]);

  // The rows in view keep their place when the held-rows button appears or counts up: the
  // anchor row's document offset is compared, so the Admin's own scrolling is left alone.
  useLayoutEffect(() => {
    const row = firstRow();
    const seq = rows[0]?.seq ?? null;
    if (row === null || seq === null) {
      firstRowTop.current = null;
      return;
    }
    const offset = row.getBoundingClientRect().top + window.scrollY;
    const anchor = firstRowTop.current;
    if (anchor !== null && anchor.seq === seq && Math.abs(offset - anchor.offset) > 0.5) {
      window.scrollBy(0, offset - anchor.offset);
    }
    firstRowTop.current = {
      seq,
      offset: row.getBoundingClientRect().top + window.scrollY,
    };
  });

  const showHeld = (): void => {
    const merged = [...held, ...rows].sort((a, b) => b.seq - a.seq);
    const newest = held[0]?.seq;
    setRows(merged);
    const nextTotal = total + held.length;
    setTotal(nextTotal);
    setShownStatus(COPY.rowsShown(merged.length, nextTotal));
    setHeld([]);
    setUpdates('');
    firstRowTop.current = null;
    window.setTimeout(() => {
      const link = document.querySelector<HTMLElement>(`[data-focus-key="seq:${newest}"]`);
      link?.scrollIntoView({ block: 'center' });
      link?.focus();
    }, 0);
  };

  const loadOlder = async (): Promise<void> => {
    if (nextBefore === null) return;
    setShownStatus(COPY.loading);
    const result = await api<{ rows: AuditRow[]; total: number; next_before_seq: number | null }>(
      'GET',
      `/api/audit?limit=${PAGE_SIZE}&before_seq=${nextBefore}`,
    );
    if (!result.ok) {
      setShownStatus(result.error.message);
      return;
    }
    const merged = [...rows, ...result.data.rows];
    setRows(merged);
    setNextBefore(result.data.next_before_seq);
    setHasOlder(result.data.next_before_seq !== null);
    setShownStatus(COPY.rowsShown(merged.length, Math.max(total, result.data.total)));
  };

  const followSeq = (seq: number): void => {
    const oldest = rows[rows.length - 1]?.seq ?? seq;
    window.history.replaceState(
      { adminOldestSeq: oldest, followedSeq: seq } satisfies AdminHistoryState,
      '',
      window.location.pathname + window.location.search,
    );
    store.navigate(`/catalog?as_of=${seq}`);
  };

  return (
    <section className="audit-log">
      <h2>Audit log</h2>
      <p role="status" aria-label="Audit log updates" className="activity">
        {updates}
      </p>
      {held.length > 0 ? (
        <button type="button" onClick={showHeld}>
          {COPY.showNewAuditRows(held.length)}
        </button>
      ) : null}
      <table role="table" aria-label="Audit log" className="audit-table" ref={tableRef}>
        <thead role="rowgroup">
          <tr role="row">
            {['Seq', 'When', 'Actor', 'Role', 'Action', 'Target', 'Before', 'After'].map((head) => (
              <th role="columnheader" scope="col" key={head}>
                {head}
              </th>
            ))}
          </tr>
        </thead>
        <tbody role="rowgroup">
          {rows.map((row) => (
            <tr role="row" key={row.seq}>
              <td role="cell" className="mono">
                <span className="cell-label">Seq</span>
                <a
                  href={`/catalog?as_of=${row.seq}`}
                  data-focus-key={`seq:${row.seq}`}
                  onClick={(event) => {
                    event.preventDefault();
                    followSeq(row.seq);
                  }}
                >
                  {row.seq}
                </a>
              </td>
              <td role="cell" className="mono">
                <span className="cell-label">When</span>
                <span data-at={row.at}>{formatViewerZoneTime(row.at)}</span>
              </td>
              <td role="cell">
                <span className="cell-label">Actor</span>
                {row.actor.name}
              </td>
              <td role="cell">
                <span className="cell-label">Role</span>
                {row.actor_role}
              </td>
              <td role="cell">
                <span className="cell-label">Action</span>
                {row.action}
              </td>
              <td role="cell" className="break-anywhere">
                <span className="cell-label">Target</span>
                {row.target.id}
              </td>
              <td role="cell" className="break-anywhere">
                <span className="cell-label">Before</span>
                {row.before === null ? '' : JSON.stringify(row.before)}
              </td>
              <td role="cell" className="break-anywhere">
                <span className="cell-label">After</span>
                {row.after === null ? '' : JSON.stringify(row.after)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p role="status" aria-label="Audit rows shown" className="activity">
        {shownStatus}
      </p>
      {hasOlder ? (
        <button type="button" onClick={() => void loadOlder()}>
          Load older audit rows
        </button>
      ) : null}
    </section>
  );
}

export function Admin(): ReactNode {
  const state = useAppState();
  if (state.session?.role !== 'Admin') {
    return (
      <div className="admin">
        <h1 tabIndex={-1} data-focus-key="admin-only-heading">
          {COPY.adminOnly}
        </h1>
        <p>You don&apos;t have permission to do that.</p>
      </div>
    );
  }
  return (
    <div className="admin">
      <h1 tabIndex={-1} data-focus-key="admin-heading">
        Admin
      </h1>
      <p role="status" aria-label="Activity" className="activity">
        {state.activity}
      </p>
      <UsersTable />
      <CatalogAsOf />
      <ChainCheck />
      <AuditLog />
    </div>
  );
}
