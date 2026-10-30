import { useCallback, useEffect, useState } from 'react';
import { apiDownload, apiGet, apiSend, saveBlob } from '../api';
import { useFeedback } from '../feedback';
import { formatAmount, formatHoursMinutes, kitchenToday } from '../kitchenTime';
import type { HourLedger, HourPack, Invoice, Tenant, User } from '../types';

const REASON_WORDS: Record<string, string> = {
  opening_balance: 'Opening balance',
  pack_purchase: 'Pack purchase',
  booking: 'Booking',
  cancellation_return: 'Cancellation return',
  fee_refund: 'Fee refund',
};

export function BillingScreen({ user }: { user: User }): JSX.Element {
  const { perform, background, fieldErrors } = useFeedback();
  const [packs, setPacks] = useState<HourPack[]>([]);
  const [ledger, setLedger] = useState<HourLedger | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantId, setTenantId] = useState('');
  const [period, setPeriod] = useState(() => kitchenToday().slice(0, 7));

  const operator = user.role === 'operator';

  const load = useCallback(
    async (announce: boolean, ledgerTenant: string | null): Promise<void> => {
      const run = async (): Promise<{
        packs: HourPack[];
        invoices: Invoice[];
        tenants: Tenant[];
        ledger: HourLedger | null;
      }> => {
        const [packList, invoiceList, tenantList] = await Promise.all([
          apiGet<{ packs: HourPack[] }>('/api/hour-packs'),
          apiGet<{ invoices: Invoice[] }>('/api/invoices'),
          apiGet<{ tenants: Tenant[] }>('/api/tenants'),
        ]);
        const target = ledgerTenant ?? (operator ? null : user.tenant_id);
        const ledgerResult = target
          ? await apiGet<HourLedger>(`/api/hour-ledger?tenant_id=${target}`)
          : null;
        return {
          packs: packList.packs,
          invoices: invoiceList.invoices,
          tenants: tenantList.tenants,
          ledger: ledgerResult,
        };
      };
      const result = announce
        ? await perform({ pending: 'Loading…', success: () => '', run })
        : await background({ run });
      if (result) {
        setPacks(result.packs);
        setInvoices(result.invoices);
        setTenants(result.tenants);
        setLedger(result.ledger);
        setTenantId((current) => current || (result.tenants[0]?.id ?? ''));
      }
    },
    [perform, background, operator, user.tenant_id],
  );

  useEffect(() => {
    void load(true, null);
  }, [load]);

  const buyPack = async (pack: HourPack): Promise<void> => {
    await perform({
      pending: `Buying ${pack.name}…`,
      success: (result: { balance_minutes: number }) =>
        `${pack.name} added. Balance: ${formatHoursMinutes(result.balance_minutes)}.`,
      errors: (failure) =>
        failure.code === 'billing_unavailable'
          ? 'Billing is unreachable. Nothing was charged and your balance is unchanged.'
          : null,
      run: () =>
        apiSend<{ balance_minutes: number }>(
          'POST',
          '/api/hour-packs/purchase',
          { pack_id: pack.id },
          { idempotencyKey: crypto.randomUUID() },
        ),
    });
    void load(false, operator ? tenantId : null);
  };

  const downloadPdf = async (invoice: Invoice): Promise<void> => {
    const result = await perform({
      pending: 'Preparing PDF…',
      success: () => '',
      errors: (failure) =>
        failure.code === 'storage_unavailable'
          ? 'Document storage is unreachable. Try again in a moment.'
          : null,
      run: () => apiDownload(`/api/invoices/${invoice.id}/pdf`),
    });
    if (result) saveBlob(result.blob, result.fileName);
  };

  const payInvoice = async (invoice: Invoice): Promise<void> => {
    await perform({
      pending: 'Paying…',
      success: () => `Invoice ${invoice.number} paid. A receipt is queued for ${user.email}.`,
      errors: (failure) => {
        if (failure.code === 'invoice_paid') return 'This invoice is already paid.';
        if (failure.code === 'billing_unavailable') {
          return 'Billing is unreachable. Nothing was charged; try again in a moment.';
        }
        return null;
      },
      run: () =>
        apiSend<Invoice>('POST', `/api/invoices/${invoice.id}/pay`, {}, {
          idempotencyKey: crypto.randomUUID(),
        }),
    });
    void load(false, operator ? tenantId : null);
  };

  const issueInvoice = async (): Promise<void> => {
    const business = tenants.find((tenant) => tenant.id === tenantId)?.business_name ?? tenantId;
    await perform({
      pending: 'Issuing invoice…',
      success: (invoice: Invoice) =>
        `Invoice ${invoice.number} issued. Its email notice is queued for ${business}.`,
      errors: (failure) => {
        if (failure.code === 'nothing_to_invoice') return `Nothing to invoice for ${period}.`;
        if (failure.code === 'billing_unavailable') {
          return 'Billing is unreachable. Nothing was charged; try again in a moment.';
        }
        if (failure.code === 'storage_unavailable') {
          return 'Document storage is unreachable. No invoice was issued; try again in a moment.';
        }
        return null;
      },
      run: () => apiSend<Invoice>('POST', '/api/invoices', { tenant_id: tenantId, period }),
    });
    void load(false, tenantId);
  };

  return (
    <div>
      <h1>Billing</h1>

      <section className="panel" aria-label="Hour pack">
        <h2>Hour pack</h2>
        {operator ? (
          <div className="field">
            <label htmlFor="ledger-tenant">Tenant</label>
            <select
              id="ledger-tenant"
              value={tenantId}
              onChange={(event) => {
                setTenantId(event.target.value);
                void load(false, event.target.value);
              }}
            >
              {tenants.map((tenant) => (
                <option key={tenant.id} value={tenant.id}>
                  {tenant.business_name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <p className="mono">Balance {formatHoursMinutes(ledger?.balance_minutes ?? 0)}</p>
        {user.role === 'owner' ? (
          <div className="row-actions">
            {packs.map((pack) => (
              <button key={pack.id} type="button" onClick={() => void buyPack(pack)}>
                Buy {pack.name}
              </button>
            ))}
          </div>
        ) : null}
        <div className="table-wrap">
          <table role="table" aria-label="Hour ledger">
            <thead role="rowgroup">
              <tr role="row">
                <th role="columnheader">When</th>
                <th role="columnheader">Movement</th>
                <th role="columnheader">Booking</th>
                <th role="columnheader">Minutes</th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              {(ledger?.entries ?? []).map((entry) => (
                <tr role="row" key={entry.id}>
                  <td role="cell" data-label="When" className="num">
                    {entry.created_at.slice(0, 16).replace('T', ' ')}
                  </td>
                  <td role="cell" data-label="Movement">
                    {REASON_WORDS[entry.reason] ?? entry.reason} ({entry.account})
                  </td>
                  <td role="cell" data-label="Booking" className="num">
                    {entry.booking_id ? entry.booking_id.slice(0, 8) : ''}
                  </td>
                  <td role="cell" data-label="Minutes" className="num">
                    {entry.minutes}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {operator ? (
        <section className="panel">
          <h2>Issue invoice</h2>
          <div className="inline-form">
            <div className="field">
              <label htmlFor="invoice-month">Invoice month</label>
              <input
                id="invoice-month"
                type="month"
                value={period}
                aria-describedby={fieldErrors['period'] ? 'period-error' : undefined}
                onChange={(event) => setPeriod(event.target.value)}
              />
              {fieldErrors['period'] ? (
                <p className="field-error" id="period-error">
                  {fieldErrors['period']}
                </p>
              ) : null}
            </div>
            <button type="button" className="primary" onClick={() => void issueInvoice()}>
              Issue invoice
            </button>
          </div>
        </section>
      ) : null}

      <div className="table-wrap">
        <table role="table" aria-label="Invoices">
          <thead role="rowgroup">
            <tr role="row">
              <th role="columnheader">Number</th>
              <th role="columnheader">Period</th>
              <th role="columnheader">Subtotal</th>
              <th role="columnheader">Tax</th>
              <th role="columnheader">Total</th>
              <th role="columnheader">Status</th>
              <th role="columnheader">Actions</th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            {invoices.map((invoice) => (
              <tr role="row" key={invoice.id}>
                <td role="cell" data-label="Number" className="num">
                  {invoice.number}
                </td>
                <td role="cell" data-label="Period" className="num">
                  {invoice.period}
                </td>
                <td role="cell" data-label="Subtotal" className="num">
                  {formatAmount(invoice.subtotal_cents)}
                </td>
                <td role="cell" data-label="Tax" className="num">
                  {formatAmount(invoice.tax_cents)}
                </td>
                <td role="cell" data-label="Total" className="num">
                  {formatAmount(invoice.total_cents)}
                </td>
                <td role="cell" data-label="Status">
                  {invoice.status === 'paid' ? 'Paid' : 'Issued'}
                </td>
                <td role="cell" data-label="Actions">
                  <div className="row-actions">
                    <a
                      href={`/api/invoices/${invoice.id}/pdf`}
                      onClick={(event) => {
                        event.preventDefault();
                        void downloadPdf(invoice);
                      }}
                    >
                      Download PDF {invoice.number}
                    </a>
                    {user.role === 'owner' && invoice.status === 'issued' ? (
                      <button type="button" onClick={() => void payInvoice(invoice)}>
                        Pay invoice {invoice.number}
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
