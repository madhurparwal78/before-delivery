import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';

import type { Booking, LedgerTransaction, MemberSummary } from '../../shared/api.js';
import { formatHours } from '../../shared/format.js';
import { addDays } from '../../shared/time.js';
import { api } from '../api.js';
import { useAction, useApp } from '../app-state.js';

interface LedgerView {
  member_id: string;
  balance_minutes: number;
  transactions: LedgerTransaction[];
}

const REVERSIBLE = new Set(['adjustment', 'opening']);

export function MembersScreen(): ReactNode {
  const act = useAction();
  const app = useApp();
  const today = app.kitchen?.today ?? '';
  const [members, setMembers] = useState<MemberSummary[]>([]);
  const [ledgers, setLedgers] = useState<Record<string, LedgerView>>({});
  const [lateCancellations, setLate] = useState<Booking[]>([]);
  const [forms, setForms] = useState<Record<string, { minutes: string; reason: string }>>({});
  const [busy, setBusy] = useState('');

  const refresh = useCallback(async () => {
    const list = await api<{ members: MemberSummary[] }>('/api/members');
    setMembers(list.members);
    const loaded: Record<string, LedgerView> = {};
    for (const member of list.members) {
      loaded[member.id] = await api<LedgerView>(`/api/ledger?member_id=${member.id}`);
    }
    setLedgers(loaded);

    const bookings = await api<{ bookings: Booking[] }>(
      `/api/bookings?from=${addDays(today, -31)}&to=${addDays(today, 30)}`,
    );
    setLate(bookings.bookings.filter((booking) => booking.fee !== null));
  }, [today]);

  useEffect(() => {
    if (today !== '') void refresh().catch(() => undefined);
  }, [refresh, today]);

  const adjust = async (memberId: string, event: FormEvent): Promise<void> => {
    event.preventDefault();
    const form = forms[memberId] ?? { minutes: '', reason: '' };
    setBusy(`adjust-${memberId}`);
    await act(
      'Adjusting hours…',
      async () => {
        const result = await api<{ balance_minutes: number }>('/api/ledger/adjustments', {
          method: 'POST',
          body: {
            member_id: memberId,
            minutes: Math.round(Number(form.minutes) * 60),
            reason: form.reason,
          },
        });
        setForms((current) => ({ ...current, [memberId]: { minutes: '', reason: '' } }));
        await refresh();
        return `Hours adjusted. Balance: ${formatHours(result.balance_minutes)} h.`;
      },
      (error) =>
        error.code === 'insufficient_hours'
          ? 'That would take the balance below zero.'
          : 'That would take the balance below zero.',
    );
    setBusy('');
  };

  const reverse = async (transaction: LedgerTransaction): Promise<void> => {
    setBusy(`reverse-${transaction.id}`);
    await act(
      'Reversing…',
      async () => {
        const result = await api<{ balance_minutes: number }>(
          `/api/ledger/transactions/${transaction.id}/reverse`,
          { method: 'POST', body: { reason: 'Reversed by the operator' } },
        );
        await refresh();
        return `Transaction reversed. Balance: ${formatHours(result.balance_minutes)} h.`;
      },
      (error) => {
        if (error.code === 'already_reversed') return 'That transaction was already reversed.';
        if (error.code === 'not_reversible') {
          return 'Only adjustments and opening balances can be reversed.';
        }
        return 'That would take the balance below zero.';
      },
    );
    setBusy('');
  };

  const waive = async (booking: Booking): Promise<void> => {
    setBusy(`waive-${booking.id}`);
    await act(
      'Waiving fee…',
      async () => {
        await api(`/api/bookings/${booking.id}/waive-fee`, { method: 'POST', body: {} });
        await refresh();
        return 'Late-cancellation fee waived.';
      },
      () => 'There is no fee left to waive on this booking.',
    );
    setBusy('');
  };

  return (
    <>
      <h1>Members</h1>

      <table>
        <caption>Members</caption>
        <thead>
          <tr>
            <th scope="col">Business</th>
            <th scope="col">Contact</th>
            <th scope="col">Balance</th>
            <th scope="col">Insurance</th>
          </tr>
        </thead>
        <tbody>
          {members.map((member) => (
            <tr key={member.id}>
              <td data-label="Business">{member.business_name}</td>
              <td data-label="Contact">{member.contact_email}</td>
              <td data-label="Balance" className="num">
                {formatHours(member.balance_minutes)} h
              </td>
              <td data-label="Insurance">
                {member.liability_insurance === null
                  ? 'None on file'
                  : `${member.liability_insurance.status} · ${member.liability_insurance.expires_on}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {members.map((member) => (
        <section className="section" key={member.id}>
          <h2>{member.business_name}</h2>
          <form
            aria-label="Adjust hours"
            className="inline-form"
            onSubmit={(event) => void adjust(member.id, event)}
          >
            <span>
              <label htmlFor={`hours-${member.id}`}>Hours change</label>
              <input
                id={`hours-${member.id}`}
                type="text"
                value={forms[member.id]?.minutes ?? ''}
                onChange={(event) =>
                  setForms((current) => ({
                    ...current,
                    [member.id]: {
                      minutes: event.target.value,
                      reason: current[member.id]?.reason ?? '',
                    },
                  }))
                }
              />
            </span>
            <span>
              <label htmlFor={`reason-${member.id}`}>Reason</label>
              <input
                id={`reason-${member.id}`}
                type="text"
                value={forms[member.id]?.reason ?? ''}
                onChange={(event) =>
                  setForms((current) => ({
                    ...current,
                    [member.id]: {
                      minutes: current[member.id]?.minutes ?? '',
                      reason: event.target.value,
                    },
                  }))
                }
              />
            </span>
            <button
              type="submit"
              className="primary"
              disabled={busy === `adjust-${member.id}`}
              aria-busy={busy === `adjust-${member.id}`}
            >
              Adjust hours
            </button>
          </form>

          <table>
            <caption>Member ledger</caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Kind</th>
                <th scope="col">Hours</th>
                <th scope="col">Reason</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {(ledgers[member.id]?.transactions ?? []).map((transaction) => (
                <tr key={transaction.id}>
                  <td data-label="Date" className="num">
                    {transaction.created_at.slice(0, 10)}
                  </td>
                  <td data-label="Kind">{transaction.kind}</td>
                  <td data-label="Hours" className="num">
                    {formatHours(transaction.member_minutes)}
                  </td>
                  <td data-label="Reason">{transaction.reason ?? '—'}</td>
                  <td data-label="Action">
                    {REVERSIBLE.has(transaction.kind) && transaction.reversed_by === null ? (
                      <button
                        type="button"
                        disabled={busy === `reverse-${transaction.id}`}
                        aria-busy={busy === `reverse-${transaction.id}`}
                        onClick={() => void reverse(transaction)}
                      >
                        Reverse
                      </button>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      <table>
        <caption>Late cancellations</caption>
        <thead>
          <tr>
            <th scope="col">Business</th>
            <th scope="col">Station</th>
            <th scope="col">Date</th>
            <th scope="col">Fee</th>
            <th scope="col">Fee status</th>
            <th scope="col">Action</th>
          </tr>
        </thead>
        <tbody>
          {lateCancellations.map((booking) => (
            <tr key={booking.id}>
              <td data-label="Business">{booking.business_name}</td>
              <td data-label="Station">{booking.station_name}</td>
              <td data-label="Date" className="num">
                {booking.date}
              </td>
              <td data-label="Fee" className="num">
                ${booking.fee?.amount}
              </td>
              <td data-label="Fee status">{booking.fee?.status}</td>
              <td data-label="Action">
                {booking.fee?.status === 'waived' ? (
                  '—'
                ) : (
                  <button
                    type="button"
                    disabled={busy === `waive-${booking.id}`}
                    aria-busy={busy === `waive-${booking.id}`}
                    onClick={() => void waive(booking)}
                  >
                    Waive fee
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
