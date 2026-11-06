import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { MemberSummary } from '../../shared/types';
import { formatHours } from '../../shared/format';
import { ApiFailure, api, newIdempotencyKey } from '../api';
import type { Session } from '../app';
import { useServices } from '../services';
import { DataTable, type Column } from '../ui/DataTable';

export function MembersScreen({ session }: { session: Session }): ReactNode {
  const [members, setMembers] = useState<MemberSummary[]>([]);
  const [status, setStatus] = useState('');
  const [statusError, setStatusError] = useState(false);
  const [busy, setBusy] = useState(false);
  const services = useServices();

  const reload = useCallback(() => {
    void api
      .members(session.kitchen.id)
      .then(({ members: found }) => setMembers(found))
      .catch(() => undefined);
  }, [session.kitchen.id]);

  useEffect(reload, [reload]);

  const buy = (member: MemberSummary): void => {
    setBusy(true);
    setStatusError(false);
    setStatus('Adding pack…');
    void api
      .buyPack(member.id, newIdempotencyKey())
      .then((result) => {
        setStatus(`20-hour pack added. Balance ${formatHours(result.balance_quarters)} hours.`);
        reload();
      })
      .catch((failure: unknown) => {
        setStatusError(true);
        if (failure instanceof ApiFailure && failure.body.error === 'billing_unavailable') {
          setStatus('Billing is unreachable. Pack purchases are paused; try again shortly.');
        } else if (failure instanceof ApiFailure) {
          setStatus(failure.message);
        }
      })
      .finally(() => setBusy(false));
  };

  const columns: Column<MemberSummary>[] = [
    { label: 'Business', render: (row) => row.business },
    { label: 'Contact', render: (row) => row.contact_email },
    {
      label: 'Papers covered until',
      render: (row) =>
        row.covered_until === null ? (
          <span className="pill bad">not covered</span>
        ) : (
          <span className="num">{row.covered_until}</span>
        ),
    },
    { label: 'Hours this month', num: true, render: (row) => row.month_hours },
    { label: 'Pack balance', num: true, render: (row) => formatHours(row.pack_balance_quarters) },
    {
      label: 'Pack',
      render: (row) => (
        <button
          type="button"
          disabled={busy || services.paused('buy_pack')}
          onClick={() => buy(row)}
        >
          Buy 20-hour pack
        </button>
      ),
    },
  ];

  return (
    <div className="page">
      <header>
        <h1>Members</h1>
        <p>Every food business renting stations at {session.kitchen.name}.</p>
      </header>

      <p role="status" aria-label="Form status" className={`status-line${statusError ? ' error' : ''}`}>
        {status}
      </p>

      <DataTable
        label="Members"
        columns={columns}
        rows={members}
        rowKey={(row) => row.id}
        empty="No members yet."
      />
    </div>
  );
}
