import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Booking, Invoice, Movement } from '../../shared/types';
import { formatAmount, formatHours } from '../../shared/format';
import { ApiFailure, api, newIdempotencyKey } from '../api';
import type { Session } from '../app';
import { useServices } from '../services';
import { DataTable, type Column } from '../ui/DataTable';

export function BillingScreen({ session }: { session: Session }): ReactNode {
  const memberId = session.user.member_id;
  const [balance, setBalance] = useState(0);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [selected, setSelected] = useState<string | null>(
    new URLSearchParams(window.location.search).get('invoice'),
  );
  const [status, setStatus] = useState('');
  const [statusError, setStatusError] = useState(false);
  const [busy, setBusy] = useState(false);
  const services = useServices();

  const reload = useCallback(() => {
    if (!memberId) return;
    void api
      .pack(memberId)
      .then((pack) => {
        setBalance(pack.balance_quarters);
        setMovements(pack.movements);
      })
      .catch(() => undefined);
    void api
      .invoices()
      .then(({ invoices: found }) => setInvoices(found))
      .catch(() => undefined);
    void api
      .bookings()
      .then(({ bookings: found }) => setBookings(found))
      .catch(() => undefined);
  }, [memberId]);

  useEffect(reload, [reload]);

  const refFor = useMemo(() => {
    const map = new Map<string, string>();
    for (const booking of bookings) map.set(booking.id, booking.ref);
    return map;
  }, [bookings]);

  const runningBalances = useMemo(() => {
    let total = 0;
    return movements.map((movement) => {
      total += movement.entries
        .filter((entry) => entry.account === 'member_pack')
        .reduce((sum, entry) => sum + entry.quarters, 0);
      return total;
    });
  }, [movements]);

  const buy = (): void => {
    if (!memberId) return;
    setBusy(true);
    setStatus('Adding pack…');
    setStatusError(false);
    void api
      .buyPack(memberId, newIdempotencyKey())
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

  const movementColumns: Column<Movement>[] = [
    {
      label: 'Date',
      render: (row) => <span className="num">{row.created_at.slice(0, 10)}</span>,
    },
    { label: 'Kind', render: (row) => row.kind },
    {
      label: 'Hours',
      num: true,
      render: (row) =>
        `${row.kind === 'draw' ? '−' : '+'}${formatHours(row.quarters)}`,
    },
    {
      label: 'Booking',
      render: (row) => (
        <span className="num">{row.booking_id ? (refFor.get(row.booking_id) ?? '—') : '—'}</span>
      ),
    },
    {
      label: 'Balance after',
      num: true,
      render: (row) => formatHours(runningBalances[movements.indexOf(row)] ?? 0),
    },
  ];

  const invoiceColumns: Column<Invoice>[] = [
    { label: 'Invoice', render: (row) => <span className="num">{row.ref}</span> },
    { label: 'Kind', render: (row) => row.kind },
    { label: 'Issued', render: (row) => <span className="num">{row.issued_at.slice(0, 10)}</span> },
    { label: 'Total', num: true, render: (row) => row.total },
    {
      label: 'Billing invoice',
      render: (row) => <span className="num">{row.killbill_invoice_id ?? '—'}</span>,
    },
    {
      label: 'Billing amount',
      num: true,
      render: (row) =>
        row.billing_amount_cents === null ? '—' : `$${formatAmount(row.billing_amount_cents)}`,
    },
  ];

  const openInvoice = invoices.find((invoice) => invoice.id === selected) ?? null;

  return (
    <div className="page">
      <header>
        <h1>Billing</h1>
        <p>Prepaid hour packs and invoices for {session.kitchen.name}.</p>
      </header>

      <p role="status" aria-label="Form status" className={`status-line${statusError ? ' error' : ''}`}>
        {status}
      </p>

      <section className="section">
        <h3 id="pack-balance">Pack balance</h3>
        <p className="big-figure num" aria-describedby="pack-balance">
          {formatHours(balance)} hours
        </p>
        <button
          type="button"
          className="primary"
          disabled={busy || services.paused('buy_pack')}
          onClick={buy}
        >
          Buy 20-hour pack
        </button>
      </section>

      <section className="section">
        <h3>Pack movements</h3>
        <DataTable
          label="Pack movements"
          columns={movementColumns}
          rows={movements}
          rowKey={(row) => row.id}
          empty="No pack movements yet."
        />
      </section>

      <section className="section">
        <h3>Invoices</h3>
        <DataTable
          label="Invoices"
          columns={invoiceColumns}
          rows={invoices}
          rowKey={(row) => row.id}
          selectedKey={selected}
          onSelect={(row) => setSelected(row.id)}
          empty="No invoices yet."
        />
      </section>

      {openInvoice && (
        <section className="detail" aria-label={`Invoice ${openInvoice.ref}`}>
          <h3>{openInvoice.ref}</h3>
          <ul className="summary-list">
            {openInvoice.lines.map((line, index) => (
              <li key={index}>
                <span>
                  {'station' in line
                    ? `${line.station} · tier ${line.tier} · ${line.hours} h`
                    : line.description}
                </span>
                <span className="num">
                  {'paid_by' in line && line.paid_by === 'pack'
                    ? 'pack'
                    : `$${formatAmount(line.amount_cents)}`}
                </span>
              </li>
            ))}
            <li>
              <strong>Total</strong>
              <strong className="num">{openInvoice.total}</strong>
            </li>
          </ul>
          <dl>
            <dt>Billing invoice</dt>
            <dd className="num">{openInvoice.killbill_invoice_id ?? '—'}</dd>
            <dt>Billing amount</dt>
            <dd className="num">
              {openInvoice.billing_amount_cents === null
                ? '—'
                : `$${formatAmount(openInvoice.billing_amount_cents)}`}
            </dd>
          </dl>
        </section>
      )}
    </div>
  );
}
