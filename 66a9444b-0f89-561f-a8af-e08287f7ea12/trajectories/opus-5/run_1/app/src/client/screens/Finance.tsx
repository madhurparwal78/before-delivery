import { useCallback, useEffect, useState } from 'react';
import { ApiError, newIdempotencyKey, request } from '../lib/api.js';
import { formatDate, formatEuros } from '../lib/festival.js';
import { useUser } from '../lib/store.js';
import type { Invoice, Mismatch, Order } from '../lib/types.js';
import type { JSX } from 'react';

type Tab = 'orders' | 'invoices' | 'vouchers' | 'reconciliation';

interface Movement {
  id: string;
  kind: string;
  amount_cents: number;
  created_at: string;
  actor: string;
  order_ref: string | null;
  entries: Array<{ account: string; side: string; amount_cents: number }>;
}

export function FinanceScreen(): JSX.Element {
  const { user, loading } = useUser();
  const [tab, setTab] = useState<Tab>('orders');
  const [orders, setOrders] = useState<Order[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [mismatches, setMismatches] = useState<Mismatch[]>([]);
  const [status, setStatus] = useState('');
  const [selectedLines, setSelectedLines] = useState<string[]>([]);
  const [refundReason, setRefundReason] = useState('Cancelled by arrangement');
  const [voucherAmount, setVoucherAmount] = useState('2000');
  const [ledgerAccount, setLedgerAccount] = useState('voucher:KERF-GIFT-A1');
  const [movements, setMovements] = useState<Movement[]>([]);
  const [resolving, setResolving] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    const [orderBody, invoiceBody, mismatchBody] = await Promise.all([
      request<{ orders: Order[] }>('/api/finance/orders'),
      request<{ invoices: Invoice[] }>('/api/invoices'),
      request<{ mismatches: Mismatch[] }>('/api/finance/mismatches'),
    ]);
    setOrders(orderBody.orders);
    setInvoices(invoiceBody.invoices);
    setMismatches(mismatchBody.mismatches);
  }, []);

  useEffect(() => {
    if (user === null || user.role !== 'finance') return;
    void load();
  }, [user, load, tab]);

  if (loading) return <section className="wide ground-paper">Loading…</section>;
  if (user === null || user.role !== 'finance') {
    return (
      <section className="narrow ground-paper">
        <h1 className="display">Finance</h1>
        <p>Only finance operators can use this screen.</p>
      </section>
    );
  }

  const refund = async (order: Order): Promise<void> => {
    const lines = order.lines.filter((line) => selectedLines.includes(line.id));
    if (lines.length === 0) {
      setStatus('Select the lines to refund first.');
      return;
    }
    try {
      await request(`/api/finance/orders/${order.id}/refunds`, {
        method: 'POST',
        headers: { 'idempotency-key': newIdempotencyKey() },
        body: { line_ids: lines.map((line) => line.id), reason: refundReason },
      });
      setStatus(`Refund started for ${lines.length} lines.`);
      setSelectedLines([]);
      await load();
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      if (error.failure.code === 'payment_unavailable') {
        setStatus('The payment service is unavailable. Try again in a moment.');
        return;
      }
      if (error.failure.code === 'line_not_refundable') {
        setStatus('Those lines can no longer be refunded.');
        return;
      }
      setStatus('That refund was refused.');
    }
  };

  const recordReturn = async (invoice: Invoice): Promise<void> => {
    try {
      const updated = await request<Invoice>(`/api/finance/invoices/${invoice.id}/returns`, {
        method: 'POST',
        body: { note: `Bank return recorded by ${user.email}` },
      });
      setStatus(
        updated.status === 'written_off'
          ? `Return recorded. Invoice ${updated.number} is written off.`
          : `Return recorded. Next retry on ${formatDate(updated.next_retry_at ?? updated.due_at)}.`,
      );
      await load();
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      if (error.failure.code === 'payment_unavailable') {
        setStatus('The payment service is unavailable. Try again in a moment.');
        return;
      }
      setStatus('That invoice has not been collected.');
    }
  };

  const issueVoucher = async (): Promise<void> => {
    try {
      const body = await request<{ code: string; balance_cents: number }>('/api/finance/vouchers', {
        method: 'POST',
        body: { amount_cents: Number(voucherAmount), note: 'Issued at the box office' },
      });
      setStatus(`Voucher ${body.code} issued for ${formatEuros(body.balance_cents)}.`);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      setStatus('Choose an amount between 1 and 100000 cents.');
    }
  };

  const loadLedger = async (): Promise<void> => {
    try {
      const body = await request<{ movements: Movement[]; balance_cents: number }>(
        `/api/finance/ledger?account=${encodeURIComponent(ledgerAccount)}`,
      );
      setMovements(body.movements);
      setStatus(`Balance ${formatEuros(body.balance_cents)}.`);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      setStatus('That account is unknown.');
    }
  };

  const runReconciliation = async (): Promise<void> => {
    setStatus('Reconciling with the payment service…');
    try {
      const body = await request<{ mismatches: Mismatch[] }>('/api/finance/reconciliation-runs', {
        method: 'POST',
      });
      const open = body.mismatches.filter((mismatch) => mismatch.status === 'open');
      setStatus(`${open.length} open mismatches.`);
      await load();
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      setStatus('The payment service is unavailable. Try again in a moment.');
    }
  };

  const saveResolution = async (): Promise<void> => {
    if (resolving === null) return;
    if (note.trim() === '') {
      setStatus('Write a note explaining the resolution.');
      return;
    }
    try {
      await request(`/api/finance/mismatches/${resolving}/resolve`, {
        method: 'POST',
        body: { note },
      });
      setStatus('Mismatch resolved.');
      setResolving(null);
      setNote('');
      await load();
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      setStatus('That mismatch was already resolved.');
    }
  };

  return (
    <section className="finance wide ground-paper">
      <h1 className="display">Finance</h1>
      <p className="status" role="status" aria-label="Finance status">
        {status}
      </p>

      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'orders'} onClick={() => setTab('orders')}>
          Orders and refunds
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'invoices'}
          onClick={() => setTab('invoices')}
        >
          Invoices
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'vouchers'}
          onClick={() => setTab('vouchers')}
        >
          Vouchers
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'reconciliation'}
          onClick={() => setTab('reconciliation')}
        >
          Reconciliation
        </button>
      </div>

      {tab === 'orders' ? (
        <div>
          <div className="field">
            <label htmlFor="refund-reason">Refund reason</label>
            <input
              id="refund-reason"
              type="text"
              value={refundReason}
              onChange={(event) => setRefundReason(event.target.value)}
            />
          </div>
          <table className="ruled" aria-label="Orders and refunds">
            <thead>
              <tr>
                <th scope="col">Ref</th>
                <th scope="col">Buyer</th>
                <th scope="col">Status</th>
                <th scope="col">Total</th>
                <th scope="col">Lines</th>
                <th scope="col">Refund</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id}>
                  <td>{order.ref}</td>
                  <td>{order.buyer_name}</td>
                  <td>{order.status.replace(/_/g, ' ')}</td>
                  <td className="figures">{formatEuros(order.total_cents)}</td>
                  <td>
                    {order.lines.map((line) => (
                      <label key={line.id} className="checkbox">
                        <input
                          type="checkbox"
                          checked={selectedLines.includes(line.id)}
                          onChange={(event) =>
                            setSelectedLines((current) =>
                              event.target.checked
                                ? [...current, line.id]
                                : current.filter((id) => id !== line.id),
                            )
                          }
                        />
                        {`${line.title} (${line.state})`}
                      </label>
                    ))}
                  </td>
                  <td>
                    <button type="button" onClick={() => void refund(order)}>
                      Refund selected lines
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {tab === 'invoices' ? (
        <table className="ruled" aria-label="Invoices">
          <thead>
            <tr>
              <th scope="col">Number</th>
              <th scope="col">Status</th>
              <th scope="col">Amount</th>
              <th scope="col">Credited</th>
              <th scope="col">Paid</th>
              <th scope="col">Balance</th>
              <th scope="col">Due</th>
              <th scope="col">Return</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((invoice) => (
              <tr key={invoice.id}>
                <td>{invoice.number}</td>
                <td>{invoice.status.replace(/_/g, ' ')}</td>
                <td className="figures">{formatEuros(invoice.amount_cents)}</td>
                <td className="figures">{formatEuros(invoice.credited_cents)}</td>
                <td className="figures">{formatEuros(invoice.paid_cents)}</td>
                <td className="figures">{formatEuros(invoice.balance_cents)}</td>
                <td className="figures">{formatDate(invoice.due_at)}</td>
                <td>
                  <button type="button" onClick={() => void recordReturn(invoice)}>
                    {`Record bank return for ${invoice.number}`}
                  </button>
                </td>
              </tr>
            ))}
            {invoices.length === 0 ? (
              <tr>
                <td colSpan={8} className="muted">
                  No invoices yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      ) : null}

      {tab === 'vouchers' ? (
        <div>
          <div className="field">
            <label htmlFor="voucher-amount">Amount, cents</label>
            <input
              id="voucher-amount"
              type="number"
              value={voucherAmount}
              onChange={(event) => setVoucherAmount(event.target.value)}
            />
          </div>
          <button type="button" className="primary" onClick={() => void issueVoucher()}>
            Issue voucher
          </button>

          <div className="field">
            <label htmlFor="ledger-account">Ledger account</label>
            <input
              id="ledger-account"
              type="text"
              value={ledgerAccount}
              onChange={(event) => setLedgerAccount(event.target.value)}
            />
          </div>
          <button type="button" onClick={() => void loadLedger()}>
            Show ledger
          </button>

          <table className="ruled" aria-label="Voucher movements">
            <thead>
              <tr>
                <th scope="col">Kind</th>
                <th scope="col">Amount</th>
                <th scope="col">Order</th>
                <th scope="col">Entries</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((movement) => (
                <tr key={movement.id}>
                  <td>{movement.kind}</td>
                  <td className="figures">{formatEuros(movement.amount_cents)}</td>
                  <td>{movement.order_ref ?? '—'}</td>
                  <td className="figures">
                    {movement.entries
                      .map((entry) => `${entry.side} ${entry.account} ${formatEuros(entry.amount_cents)}`)
                      .join(' · ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {tab === 'reconciliation' ? (
        <div>
          <button type="button" className="primary" onClick={() => void runReconciliation()}>
            Run reconciliation
          </button>
          <table className="ruled" aria-label="Mismatches">
            <thead>
              <tr>
                <th scope="col">Type</th>
                <th scope="col">Order</th>
                <th scope="col">Transaction</th>
                <th scope="col">App</th>
                <th scope="col">Kill Bill</th>
                <th scope="col">Status</th>
                <th scope="col">Resolve</th>
              </tr>
            </thead>
            <tbody>
              {mismatches.map((mismatch) => (
                <tr key={mismatch.id}>
                  <td>{mismatch.type.replace(/_/g, ' ')}</td>
                  <td>{mismatch.order_ref ?? '—'}</td>
                  <td className="figures">{mismatch.transaction_type}</td>
                  <td className="figures">
                    {mismatch.app_amount_cents === null ? '—' : formatEuros(mismatch.app_amount_cents)}
                  </td>
                  <td className="figures">
                    {mismatch.killbill_amount_cents === null
                      ? '—'
                      : formatEuros(mismatch.killbill_amount_cents)}
                  </td>
                  <td>
                    {mismatch.status}
                    {mismatch.resolved_by === null ? '' : ` by ${mismatch.resolved_by}`}
                  </td>
                  <td>
                    {mismatch.status === 'open' ? (
                      <button type="button" onClick={() => setResolving(mismatch.id)}>
                        {`Resolve mismatch ${mismatch.id}`}
                      </button>
                    ) : (
                      <span className="muted">{mismatch.note ?? ''}</span>
                    )}
                  </td>
                </tr>
              ))}
              {mismatches.length === 0 ? (
                <tr>
                  <td colSpan={7} className="muted">
                    No mismatches.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>

          {resolving !== null ? (
            <div className="field">
              <label htmlFor="resolution-note">Resolution note</label>
              <textarea
                id="resolution-note"
                rows={3}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
              <button type="button" className="primary" onClick={() => void saveResolution()}>
                Save resolution
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
