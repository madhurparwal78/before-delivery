import { useRef, useState, type FormEvent } from 'react';
import { can, INVOICE_STATUS_LABEL } from '../../../shared/domain';
import { announce } from '../lib/announce';
import { del, errorText, lostResponse, mutate, patch, post } from '../lib/api';
import { useMe } from '../lib/env';
import { hm, parsePence, pounds } from '../lib/format';
import { useResource } from '../lib/resource';
import { Link } from '../lib/router';
import type { Invoice, StockItem } from '../lib/types';
import { Modal } from '../components/Modal';
import { SplitBand } from '../components/Shell';
import { Banner, describedBy, EmptyCard, ErrorSummary, Field, Pill, Skeleton } from '../components/ui';
import { NotFound } from './Pages';

export function Invoices() {
  const list = useResource<{ invoices: { id: string; number: string; patientName: string; status: keyof typeof INVOICE_STATUS_LABEL; totalPence: number; balancePence: number }[]; outstandingPence: number }>('/api/invoices', ['invoices']);
  return (
    <>
      <SplitBand title="Invoices">
        <p className="band-count">{`Outstanding ${pounds(list.data?.outstandingPence ?? 0)}`}</p>
      </SplitBand>
      {!list.data ? (
        <Skeleton rows={4} />
      ) : list.data.invoices.length === 0 ? (
        <EmptyCard title="No invoices yet." tone="sky" />
      ) : (
        <table aria-label="Invoices" className="data-table" role="table">
          <thead role="rowgroup">
            <tr role="row">
              <th role="columnheader">Invoice</th>
              <th role="columnheader">Patient</th>
              <th role="columnheader">Status</th>
              <th role="columnheader" className="num">
                Total
              </th>
              <th role="columnheader" className="num">
                Balance due
              </th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            {list.data.invoices.map((i) => (
              <tr key={i.id} role="row">
                <td role="cell" data-label="Invoice">
                  <Link to={`/invoices/${i.id}`} className="text-link">
                    {i.number}
                  </Link>
                </td>
                <td role="cell" data-label="Patient">
                  {i.patientName}
                </td>
                <td role="cell" data-label="Status">
                  {INVOICE_STATUS_LABEL[i.status]}
                </td>
                <td role="cell" className="num" data-label="Total">
                  {pounds(i.totalPence)}
                </td>
                <td role="cell" className="num" data-label="Balance due">
                  {pounds(i.balancePence)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

const newKey = () => `rb-${crypto.randomUUID()}`;

/** One attempt (a value, or an item and quantity) keeps one Idempotency-Key until any answer arrives or the value changes. */
function useAttempt() {
  const current = useRef<{ value: string; key: string } | null>(null);
  return {
    key: (value: string): string => {
      if (current.current?.value !== value) current.current = { value, key: newKey() };
      return current.current.key;
    },
    end: () => {
      current.current = null;
    },
  };
}

/** Sends once; when the connection is lost with no response at all, sends once more at once with the same key. */
async function sendWithResend<T>(send: () => Promise<T>): Promise<T> {
  try {
    return await send();
  } catch (error) {
    if (!lostResponse(error)) throw error;
    return send();
  }
}

function VoidDialog({ invoice, onClose, onDone }: { invoice: Invoice; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [items, setItems] = useState<{ field?: string; message: string }[]>([]);
  const [token, setToken] = useState(0);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (busy) return;
    if (reason.trim() === '') {
      setItems([{ field: 'reason', message: 'Reason is required.' }]);
      setToken((t) => t + 1);
      return;
    }
    setBusy(true);
    try {
      await mutate(
        () => post(`/api/invoices/${invoice.id}/void`, { reason }),
        () => {
          announce(`${invoice.number} voided.`);
          onDone();
          onClose();
        },
      );
    } catch (error) {
      setItems([{ message: errorText(error) }]);
      setToken((t) => t + 1);
      setBusy(false);
    }
  };
  const message = items.find((i) => i.field === 'reason')?.message;
  return (
    <Modal label="Void invoice" onClose={onClose} returnFocus={() => document.getElementById('void-button')}>
      <h2 className="modal-title">Void invoice</h2>
      <ErrorSummary items={items} token={token} fieldId={(f) => `void-${f}`} />
      <Field id="void-reason" label="Reason" error={message}>
        <input id="void-reason" type="text" value={reason} onChange={(e) => setReason(e.target.value)} {...describedBy('void-reason', message)} />
      </Field>
      <div className="modal-actions">
        <Pill busy={busy} onClick={() => void submit()}>
          Confirm void
        </Pill>
        <Pill variant="outline" className="on-light" onClick={onClose}>
          Cancel
        </Pill>
      </div>
    </Modal>
  );
}

export function InvoiceDetail({ id }: { id: string }) {
  const me = useMe();
  const invoice = useResource<Invoice>(`/api/invoices/${id}`, ['invoices']);
  const stock = useResource<{ items: StockItem[] }>('/api/stock', ['stock']);
  const [itemId, setItemId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [discount, setDiscount] = useState('');
  const [amount, setAmount] = useState('');
  const [amountError, setAmountError] = useState<string | null>(null);
  const [alert, setAlert] = useState<string | null>(null);
  const [voiding, setVoiding] = useState(false);
  const [pending, setPending] = useState<'line' | 'discount' | 'issue' | 'payment' | null>(null);
  const lineAttempt = useAttempt();
  const paymentAttempt = useAttempt();

  if (invoice.error) return <NotFound />;
  if (!invoice.data) return <Skeleton rows={5} />;
  const inv = invoice.data;
  const status = INVOICE_STATUS_LABEL[inv.status];
  const editable = inv.status === 'draft' && can(me.role, 'invoices.write');
  const canTakePayment = can(me.role, 'payments.take') && (inv.status === 'issued' || inv.status === 'part-paid');
  const canVoid = can(me.role, 'payments.take') && (inv.status === 'draft' || inv.status === 'issued');
  const markers = `${inv.discountPercent > 0 ? ' *' : ''} **`;
  const apply = (next: Invoice) => invoice.set(() => next);

  const run = async <T,>(kind: NonNullable<typeof pending>, work: () => Promise<T>, done: (r: T) => void, after?: () => void) => {
    if (pending) return;
    setPending(kind);
    setAlert(null);
    try {
      await mutate(work, done);
    } catch (error) {
      setAlert(errorText(error));
      if (!(error instanceof TypeError)) after?.();
    } finally {
      setPending(null);
    }
  };

  const addLine = (event?: FormEvent) => {
    event?.preventDefault();
    const item = stock.data?.items.find((s) => s.id === itemId);
    const count = Number(quantity);
    if (!item || !Number.isInteger(count)) {
      setAlert(!item ? 'Stock item is required.' : 'Quantity is not valid.');
      return;
    }
    const key = lineAttempt.key(`${itemId}:${quantity}`);
    void run(
      'line',
      () => sendWithResend(() => post<Invoice>(`/api/invoices/${inv.id}/lines`, { stockItemId: itemId, quantity: count }, { 'Idempotency-Key': key })),
      (next) => {
        lineAttempt.end();
        apply(next);
        announce(`Added ${item.name} x${count} to ${inv.number}.`);
      },
      lineAttempt.end,
    );
  };

  const applyDiscount = () =>
    void run(
      'discount',
      () => patch<Invoice>(`/api/invoices/${inv.id}`, { discountPercent: discount === '' ? undefined : Number(discount) }),
      apply,
    );

  const issue = () =>
    void run(
      'issue',
      () => post<Invoice>(`/api/invoices/${inv.id}/issue`),
      (next) => {
        apply(next);
        announce(`${inv.number} issued.`);
      },
    );

  const takePayment = (event?: FormEvent) => {
    event?.preventDefault();
    if (pending) return;
    const pence = parsePence(amount);
    if (pence === null) {
      setAmountError('Enter an amount like 12.50.');
      return;
    }
    setAmountError(null);
    const key = paymentAttempt.key(amount.trim());
    void run(
      'payment',
      () => sendWithResend(() => post<Invoice>(`/api/invoices/${inv.id}/payments`, { pence }, { 'Idempotency-Key': key })),
      (next) => {
        paymentAttempt.end();
        apply(next);
        setAmount('');
        announce(`Payment of ${pounds(pence)} taken. Balance due ${pounds(next.balancePence)}.`);
      },
      paymentAttempt.end,
    );
  };

  const removeLine = (lineId: string) => {
    setAlert(null);
    mutate(() => del<Invoice>(`/api/invoices/${inv.id}/lines/${lineId}`), apply).catch((error: unknown) => setAlert(errorText(error)));
  };

  return (
    <>
      <SplitBand title={`Invoice ${inv.number}`} aside={<span className="band-date">{inv.patientName}</span>}>
        <div role="group" aria-label="Status" className="status-group">
          {status}
        </div>
      </SplitBand>
      <Banner message={alert} />
      <div className="invoice-grid">
        <div>
          <table aria-label="Invoice lines" className="data-table lines" role="table">
            <thead role="rowgroup">
              <tr role="row">
                <th role="columnheader">Description</th>
                <th role="columnheader" className="num">
                  Qty
                </th>
                <th role="columnheader" className="num">
                  Unit
                </th>
                <th role="columnheader" className="num">
                  Discount
                </th>
                <th role="columnheader" className="num">
                  VAT
                </th>
                <th role="columnheader" className="num">
                  Total
                </th>
                {editable && <th role="columnheader" />}
              </tr>
            </thead>
            <tbody role="rowgroup">
              {inv.lines.map((l) => (
                <tr key={l.id} role="row">
                  <td role="cell" data-label="Description">{`${l.description}${markers}`}</td>
                  <td role="cell" className="num" data-label="Qty">
                    {l.quantity}
                  </td>
                  <td role="cell" className="num" data-label="Unit">
                    {pounds(l.unitPricePence)}
                  </td>
                  <td role="cell" className="num" data-label="Discount">
                    {pounds(l.discountPence)}
                  </td>
                  <td role="cell" className="num" data-label="VAT">
                    {pounds(l.vatPence)}
                  </td>
                  <td role="cell" className="num" data-label="Total">
                    {pounds(l.totalPence)}
                  </td>
                  {editable && (
                    <td role="cell">
                      <Pill variant="outline" className="on-light" aria-label={`Remove line, ${l.description}`} onClick={() => removeLine(l.id)}>
                        Remove
                      </Pill>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {inv.lines.length === 0 && <p className="muted pad">No lines yet.</p>}
          {editable && (
            <form className="line-form" onSubmit={addLine} noValidate>
              <Field id="line-item" label="Stock item">
                <select id="line-item" value={itemId} onChange={(e) => setItemId(e.target.value)}>
                  <option value="">Choose an item</option>
                  {stock.data?.items.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id="line-quantity" label="Quantity">
                <input id="line-quantity" type="number" min={1} max={999} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
              </Field>
              <Pill type="submit" busy={pending === 'line'}>
                Add line
              </Pill>
            </form>
          )}
          {editable && (
            <div className="line-form">
              <Field id="discount" label="Discount percent">
                <input id="discount" type="number" min={0} max={100} value={discount} placeholder={String(inv.discountPercent)} onChange={(e) => setDiscount(e.target.value)} />
              </Field>
              <Pill busy={pending === 'discount'} onClick={applyDiscount}>
                Apply discount
              </Pill>
              <Pill variant="blue" busy={pending === 'issue'} onClick={issue}>
                Issue invoice
              </Pill>
            </div>
          )}
          {canTakePayment && (
            <form className="line-form" onSubmit={takePayment} noValidate>
              <Field id="payment-amount" label="Payment amount" error={undefined}>
                <input
                  id="payment-amount"
                  type="text"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value);
                    setAmountError(null);
                  }}
                  {...describedBy('payment-amount', amountError ?? undefined)}
                />
                {amountError && (
                  <p role="alert" className="field-error" id="payment-amount-error">
                    {amountError}
                  </p>
                )}
              </Field>
              <Pill type="submit" busy={pending === 'payment'}>
                Take payment
              </Pill>
            </form>
          )}
          {canVoid && (
            <Pill id="void-button" variant="outline" className="on-light" onClick={() => setVoiding(true)}>
              Void invoice
            </Pill>
          )}
          {can(me.role, 'invoices.read') && (
            <p>
              <a className="text-link" href={`/api/invoices/${inv.id}.pdf`}>
                Export invoice PDF
              </a>
            </p>
          )}
        </div>
        <aside className="invoice-side">
          <div role="group" aria-label="Total" className="amount-card tint-mint">{`Total ${pounds(inv.totalPence)}`}</div>
          <div role="group" aria-label="Paid" className="amount-card tint-sky">{`Paid ${pounds(inv.paidPence)}`}</div>
          <div role="group" aria-label="Balance due" className="amount-card tint-rose">{`Balance due ${pounds(inv.balancePence)}`}</div>
          <h2 className="section-title">Payments</h2>
          <ul aria-label="Payments" className="payments">
            {inv.payments.map((p) => {
              const text = `${pounds(p.pence)} taken by ${p.takenBy.name} at ${hm(p.at)}`;
              return (
                <li key={p.id} aria-label={text}>
                  {text}
                </li>
              );
            })}
          </ul>
          {inv.voidedBy && (
            <div role="note" aria-label="Void record" className="void-record">{`Voided by ${inv.voidedBy.name} at ${hm(inv.voidedAt!)}: ${inv.voidReason}`}</div>
          )}
        </aside>
      </div>
      <div role="note" aria-label="Invoice footnotes" className="footnotes">
        {inv.discountPercent > 0 && <p>{`* Discount of ${inv.discountPercent}% applied to this line.`}</p>}
        <p>{`** VAT at ${inv.vatPercent}% on the line after discount.`}</p>
      </div>
      {voiding && <VoidDialog invoice={inv} onClose={() => setVoiding(false)} onDone={invoice.reload} />}
    </>
  );
}
