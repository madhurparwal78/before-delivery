import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { UsageReport } from '../../shared/types';
import { formatAmount, monthName } from '../../shared/format';
import { api } from '../api';
import type { Session } from '../app';
import { Download } from '../ui/icons';
import { DataTable, type Column } from '../ui/DataTable';

type MemberRow = UsageReport['members'][number];
type StationRow = UsageReport['stations'][number];
type InvoiceRow = UsageReport['invoices'][number];

export function ReportsScreen({ session }: { session: Session }): ReactNode {
  const { kitchen } = session;
  const [month, setMonth] = useState(kitchen.today.slice(0, 7));
  const [report, setReport] = useState<UsageReport | null>(null);
  const [status, setStatus] = useState('');

  const reload = useCallback(() => {
    if (!/^\d{4}-\d{2}$/.test(month)) return;
    setStatus('Loading report…');
    void api
      .usage(kitchen.id, month)
      .then((found) => {
        setReport(found);
        const rows = found.members.some((row) => row.booked_hours !== '0.00');
        setStatus(
          rows || found.invoices.length > 0
            ? ''
            : `No bookings in ${monthName(month)} ${month.slice(0, 4)}.`,
        );
      })
      .catch(() => {
        setReport(null);
        setStatus('');
      });
  }, [kitchen.id, month]);

  useEffect(reload, [reload]);

  const memberColumns: Column<MemberRow>[] = [
    { label: 'Business', render: (row) => row.business },
    { label: 'Booked hours', num: true, render: (row) => row.booked_hours },
    { label: 'Cancelled in window hours', num: true, render: (row) => row.cancelled_in_window_hours },
    { label: 'Billed', num: true, render: (row) => `$${formatAmount(row.billed_cents)}` },
    { label: 'Refunded', num: true, render: (row) => `$${formatAmount(row.refunded_cents)}` },
    { label: 'Pack balance', num: true, render: (row) => row.pack_balance_hours },
  ];

  const stationColumns: Column<StationRow>[] = [
    { label: 'Station', render: (row) => row.name },
    { label: 'Booked hours', num: true, render: (row) => row.booked_hours },
  ];

  const invoiceColumns: Column<InvoiceRow>[] = [
    { label: 'Invoice', render: (row) => <span className="num">{row.ref}</span> },
    { label: 'Kind', render: (row) => row.kind },
    { label: 'Issued', render: (row) => <span className="num">{row.issued_on}</span> },
    { label: 'Total', num: true, render: (row) => `$${formatAmount(row.total_cents)}` },
    {
      label: 'Billing invoice',
      render: (row) => <span className="num">{row.killbill_invoice_id ?? '—'}</span>,
    },
    { label: 'Member', render: (row) => row.business },
  ];

  return (
    <div className="page">
      <header>
        <h1>Reports</h1>
        <p>One kitchen, one kitchen-local month, in {kitchen.timezone}.</p>
      </header>

      <div className="row-split">
        <div className="field" style={{ maxWidth: 220 }}>
          <label htmlFor="report-month">Month</label>
          <input
            id="report-month"
            type="month"
            value={month}
            onChange={(event) => setMonth(event.target.value)}
          />
        </div>
        <p>
          <a href={`/api/kitchens/${kitchen.id}/reports/usage.csv?month=${month}`} download>
            <Download size={14} aria-hidden="true" /> Download CSV
          </a>
        </p>
      </div>

      <p role="status" aria-label="Form status" className="status-line">
        {status}
      </p>

      {report && (
        <>
          <section className="section">
            <h3>Usage by member</h3>
            <DataTable
              label="Usage by member"
              columns={memberColumns}
              rows={report.members}
              rowKey={(row) => row.member_id}
              empty="No members."
            />
          </section>

          <section className="section">
            <h3>Station occupancy</h3>
            <DataTable
              label="Station occupancy"
              columns={stationColumns}
              rows={report.stations}
              rowKey={(row) => row.station_id}
              empty="No stations."
            />
          </section>

          <section className="section">
            <h3>Invoices</h3>
            <DataTable
              label="Invoices"
              columns={invoiceColumns}
              rows={report.invoices}
              rowKey={(row) => row.invoice_id}
              empty="No invoices this month."
            />
          </section>
        </>
      )}
    </div>
  );
}
