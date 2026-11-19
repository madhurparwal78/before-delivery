import { useEffect, useRef, useState, type JSX } from 'react';
import { api, get, newIdempotencyKey, NoResponse } from '../api';
import { useLiveResource } from '../live';
import { AlertBanner, Dialog, EmptyCard, Pill, useAnnounce, type SummaryItem } from '../ui';
import { hm, money } from '../time';
import { ForbiddenCard, NotFoundCard, SplitBand, useApp } from '../app';
import { messageOf } from './today';

type InvoiceLine = {
  id: string;
  stockItemId: string;
  description: string;
  quantity: number;
  unitPricePence: number;
  netPence: number;
  discountPence: number;
  vatPence: number;
  totalPence: number;
};

type Invoice = {
  id: string;
  number: string;
  patientId: string;
  patientName: string;
  status: string;
  statusText: string;
  discountPercent: number;
  lines: InvoiceLine[];
  totalPence: number;
  paidPence: number;
  balancePence: number;
  payments: { id: string; pence: number; at: string; takenBy: { id: string; name: string } }[];
  voidedBy: { id: string; name: string } | null;
  voidedAt: string | null;
  voidReason: string | null;
};

type StockItem = { id: string; name: string; unitPricePence: number };

export function InvoicesScreen(): JSX.Element {
  const { navigate, session } = useApp();
  const invoices = useLiveResource<{ invoices: Invoice[] }>('/api/invoices', ['invoices']);
  if (session?.role === 'nurse') return <ForbiddenCard />;
  const list = invoices.data?.invoices ?? [];
  const outstanding = list
    .filter((invoice) => invoice.status === 'issued' || invoice.status === 'part-paid')
    .reduce((sum, invoice) => sum + invoice.balancePence, 0);
  return (
    <div className="screen">
      <SplitBand
        headline={<h1>Invoices</h1>}
        right={<p className="band-count">{`Outstanding ${money(outstanding)}`}</p>}
      />
      <div className="screen-body">
        {list.length === 0 ? (
          <EmptyCard title="No invoices yet." />
        ) : (
          <table className="data-table" aria-label="Invoices">
            <thead>
              <tr>
                <th scope="col">Number</th>
                <th scope="col">Patient</th>
                <th scope="col">Status</th>
                <th scope="col">Total</th>
                <th scope="col">Balance due</th>
                <th scope="col">Open</th>
              </tr>
            </thead>
            <tbody>
              {list.map((invoice) => (
                <tr key={invoice.id}>
                  <td>{invoice.number}</td>
                  <td>{invoice.patientName}</td>
                  <td>{invoice.statusText}</td>
                  <td>{money(invoice.totalPence)}</td>
                  <td>{money(invoice.balancePence)}</td>
                  <td>
                    <a
                      className="link"
                      href={`/invoices/${invoice.id}`}
                      onClick={(event) => {
                        event.preventDefault();
                        navigate(`/invoices/${invoice.id}`);
                      }}
                    >
                      {`Open ${invoice.number}`}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

type Attempt = { signature: string; key: string; pending: boolean };

function useAttempt(): {
  begin: (signature: string) => string | null;
  settled: () => void;
  unanswered: () => void;
} {
  const held = useRef<Attempt | null>(null);
  return {
    begin: (signature) => {
      if (held.current?.pending) return null;
      const key =
        held.current && held.current.signature === signature ? held.current.key : newIdempotencyKey();
      held.current = { signature, key, pending: true };
      return key;
    },
    settled: () => {
      held.current = null;
    },
    unanswered: () => {
      if (held.current) held.current.pending = false;
    },
  };
}

export function InvoiceDetailScreen({ invoiceId }: { invoiceId: string }): JSX.Element {
  const { navigate, session } = useApp();
  const announce = useAnnounce();
  const invoice = useLiveResource<Invoice>(`/api/invoices/${invoiceId}`, ['invoices']);
  const [items, setItems] = useState<StockItem[]>([]);
  const [vatPercent, setVatPercent] = useState(20);
  const [stockItemId, setStockItemId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [discount, setDiscount] = useState('0');
  const [payment, setPayment] = useState('');
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [alert, setAlert] = useState<string | null>(null);
  const [voiding, setVoiding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const lineAttempt = useAttempt();
  const paymentAttempt = useAttempt();

  useEffect(() => {
    void get<{ items: StockItem[] }>('/api/stock').then((data) => {
      setItems(data.items);
      setStockItemId((current) => current || data.items[0]?.id || '');
    });
    void get<{ vatPercent: number }>('/api/settings').then((data) => setVatPercent(data.vatPercent));
  }, []);

  useEffect(() => {
    if (invoice.data) setDiscount(String(invoice.data.discountPercent));
  }, [invoice.data?.discountPercent]);

  if (session?.role === 'nurse') return <ForbiddenCard />;
  if (invoice.error) return <NotFoundCard onNavigate={navigate} />;
  const detail = invoice.data;

  const addLine = async (): Promise<void> => {
    const count = Number(quantity);
    if (!stockItemId || !Number.isInteger(count) || count < 1) {
      setAlert('Quantity is not valid.');
      return;
    }
    const signature = `${stockItemId}:${count}`;
    const key = lineAttempt.begin(signature);
    if (!key) return;
    setBusy('line');
    const send = (): Promise<Invoice> =>
      api<Invoice>(
        'POST',
        `/api/invoices/${invoiceId}/lines`,
        { stockItemId, quantity: count },
        { 'Idempotency-Key': key },
      );
    try {
      let result: Invoice;
      try {
        result = await send();
      } catch (error) {
        if (!(error instanceof NoResponse)) throw error;
        lineAttempt.unanswered();
        result = await send();
      }
      lineAttempt.settled();
      invoice.reload();
      const item = items.find((candidate) => candidate.id === stockItemId);
      announce(`Added ${item?.name ?? ''} x${count} to ${result.number}.`);
      setAlert(null);
    } catch (error) {
      lineAttempt.settled();
      setAlert(messageOf(error));
      invoice.reload();
    } finally {
      setBusy(null);
    }
  };

  const takePayment = async (): Promise<void> => {
    const trimmed = payment.trim();
    if (!/^\d+(\.\d{1,2})?$/.test(trimmed) || Number(trimmed) <= 0) {
      setPaymentError('Enter an amount like 12.50.');
      return;
    }
    setPaymentError(null);
    const pence = Math.round(Number(trimmed) * 100);
    const key = paymentAttempt.begin(String(pence));
    if (!key) return;
    setBusy('payment');
    const send = (): Promise<Invoice> =>
      api<Invoice>('POST', `/api/invoices/${invoiceId}/payments`, { pence }, { 'Idempotency-Key': key });
    try {
      let result: Invoice;
      try {
        result = await send();
      } catch (error) {
        if (!(error instanceof NoResponse)) throw error;
        paymentAttempt.unanswered();
        result = await send();
      }
      paymentAttempt.settled();
      invoice.reload();
      announce(`Payment of ${money(pence)} taken. Balance due ${money(result.balancePence)}.`);
      setPayment('');
      setAlert(null);
    } catch (error) {
      paymentAttempt.settled();
      setAlert(messageOf(error));
      invoice.reload();
    } finally {
      setBusy(null);
    }
  };

  const canBuild = session?.role === 'vet' || session?.role === 'manager';
  const canMoney = session?.role === 'front-desk' || session?.role === 'manager';
  const draft = detail?.status === 'draft';
  const marker = (detail?.discountPercent ?? 0) > 0 ? ' * **' : ' **';

  return (
    <div className="screen">
      <SplitBand
        headline={<h1>{detail ? `Invoice ${detail.number}` : 'Invoice'}</h1>}
        right={
          <p className="band-count">{detail ? `Balance due ${money(detail.balancePence)}` : ''}</p>
        }
      />
      <div className="screen-body">
        <div className="invoice-head">
          <div role="group" aria-label="Status" className="status-group">
            {detail?.statusText ?? ''}
          </div>
        </div>
        <AlertBanner message={alert} />
        <div className="invoice-layout">
          <div className="invoice-main">
            <table className="data-table" aria-label="Invoice lines">
              <thead>
                <tr>
                  <th scope="col">Description</th>
                  <th scope="col">Quantity</th>
                  <th scope="col">Net</th>
                  <th scope="col">VAT</th>
                  <th scope="col">Total</th>
                  <th scope="col">Remove</th>
                </tr>
              </thead>
              <tbody>
                {(detail?.lines ?? []).map((line) => (
                  <tr key={line.id}>
                    <td>{`${line.description}${marker}`}</td>
                    <td>{line.quantity}</td>
                    <td>{money(line.netPence)}</td>
                    <td>{money(line.vatPence)}</td>
                    <td>{money(line.totalPence)}</td>
                    <td>
                      {draft && canBuild ? (
                        <Pill
                          variant="secondary"
                          name={`Remove line, ${line.description}`}
                          onClick={async () => {
                            try {
                              await api('DELETE', `/api/invoices/${invoiceId}/lines/${line.id}`);
                              invoice.reload();
                              setAlert(null);
                            } catch (error) {
                              setAlert(messageOf(error));
                            }
                          }}
                        >
                          Remove line
                        </Pill>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {canBuild ? (
              <div className="form-row">
                <div className="field">
                  <label htmlFor="stock-item">Stock item</label>
                  <select
                    id="stock-item"
                    value={stockItemId}
                    onChange={(event) => setStockItemId(event.target.value)}
                  >
                    {items.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="line-quantity">Quantity</label>
                  <input
                    id="line-quantity"
                    type="number"
                    min={1}
                    max={999}
                    value={quantity}
                    onChange={(event) => setQuantity(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void addLine();
                      }
                    }}
                  />
                </div>
                <Pill busy={busy === 'line'} onClick={() => void addLine()}>
                  Add line
                </Pill>
              </div>
            ) : null}

            {canBuild ? (
              <div className="form-row">
                <div className="field">
                  <label htmlFor="discount-percent">Discount percent</label>
                  <input
                    id="discount-percent"
                    type="number"
                    min={0}
                    max={100}
                    value={discount}
                    onChange={(event) => setDiscount(event.target.value)}
                  />
                </div>
                <Pill
                  onClick={async () => {
                    try {
                      await api('PATCH', `/api/invoices/${invoiceId}`, {
                        discountPercent: Number(discount),
                      });
                      invoice.reload();
                      setAlert(null);
                    } catch (error) {
                      setAlert(messageOf(error));
                    }
                  }}
                >
                  Apply discount
                </Pill>
              </div>
            ) : null}

            {canBuild && draft ? (
              <Pill
                onClick={async () => {
                  try {
                    const issued = await api<Invoice>('POST', `/api/invoices/${invoiceId}/issue`);
                    invoice.reload();
                    announce(`${issued.number} issued.`);
                    setAlert(null);
                  } catch (error) {
                    setAlert(messageOf(error));
                  }
                }}
              >
                Issue invoice
              </Pill>
            ) : null}

            {canMoney ? (
              <div className="form-row">
                <div className="field">
                  <label htmlFor="payment-amount">Payment amount</label>
                  <input
                    id="payment-amount"
                    type="text"
                    inputMode="decimal"
                    value={payment}
                    aria-describedby={paymentError ? 'payment-error' : undefined}
                    onChange={(event) => {
                      setPayment(event.target.value);
                      setPaymentError(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void takePayment();
                      }
                    }}
                  />
                  {paymentError ? (
                    <p className="field-error" id="payment-error" role="alert">
                      {paymentError}
                    </p>
                  ) : null}
                </div>
                <Pill busy={busy === 'payment'} onClick={() => void takePayment()}>
                  Take payment
                </Pill>
              </div>
            ) : null}

            {canMoney && detail && detail.status !== 'voided' ? (
              <Pill variant="secondary" onClick={() => setVoiding(true)}>
                Void invoice
              </Pill>
            ) : null}

            <a className="link" href={`/api/invoices/${invoiceId}.pdf`}>
              Export invoice PDF
            </a>

            <div role="note" aria-label="Invoice footnotes" className="footnotes">
              {(detail?.discountPercent ?? 0) > 0 ? (
                <p>{`* Discount of ${detail?.discountPercent}% applied to this line.`}</p>
              ) : null}
              <p>{`** VAT at ${vatPercent}% on the line after discount.`}</p>
            </div>
          </div>

          <aside className="invoice-side">
            <div role="group" aria-label="Total" className="money-group">
              {`Total ${money(detail?.totalPence ?? 0)}`}
            </div>
            <div role="group" aria-label="Paid" className="money-group">
              {`Paid ${money(detail?.paidPence ?? 0)}`}
            </div>
            <div role="group" aria-label="Balance due" className="money-group">
              {`Balance due ${money(detail?.balancePence ?? 0)}`}
            </div>
            <ul className="payments" aria-label="Payments">
              {(detail?.payments ?? []).map((item) => (
                <li
                  key={item.id}
                  aria-label={`${money(item.pence)} taken by ${item.takenBy.name} at ${hm(item.at)}`}
                >
                  {`${money(item.pence)} taken by ${item.takenBy.name} at ${hm(item.at)}`}
                </li>
              ))}
            </ul>
            {detail?.voidedAt ? (
              <div role="note" aria-label="Void record" className="void-record">
                {`Voided by ${detail.voidedBy?.name ?? ''} at ${hm(detail.voidedAt)}: ${
                  detail.voidReason ?? ''
                }`}
              </div>
            ) : null}
          </aside>
        </div>
      </div>
      {voiding ? (
        <VoidInvoiceDialog
          invoiceId={invoiceId}
          onClose={() => setVoiding(false)}
          onVoided={(number) => {
            setVoiding(false);
            invoice.reload();
            announce(`${number} voided.`);
          }}
        />
      ) : null}
    </div>
  );
}

function VoidInvoiceDialog({
  invoiceId,
  onClose,
  onVoided,
}: {
  invoiceId: string;
  onClose: () => void;
  onVoided: (number: string) => void;
}): JSX.Element {
  const [reason, setReason] = useState('');
  const [summary, setSummary] = useState<SummaryItem[]>([]);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      name="Void invoice"
      onClose={onClose}
      summary={summary}
      onSummaryLink={() => document.getElementById('void-reason')?.focus()}
    >
      <div className="field">
        <label htmlFor="void-reason">Reason</label>
        <textarea
          id="void-reason"
          value={reason}
          aria-describedby={summary.length > 0 ? 'void-reason-error' : undefined}
          onChange={(event) => setReason(event.target.value)}
        />
        {summary.length > 0 ? (
          <p className="field-error" id="void-reason-error">
            {summary[0].message}
          </p>
        ) : null}
      </div>
      <div className="dialog-actions">
        <Pill
          busy={busy}
          onClick={async () => {
            if (reason.trim().length === 0) {
              setSummary([{ field: 'Reason', message: 'Reason is required.' }]);
              return;
            }
            setBusy(true);
            try {
              const voided = await api<Invoice>('POST', `/api/invoices/${invoiceId}/void`, { reason });
              onVoided(voided.number);
            } catch (error) {
              setSummary([{ field: 'Reason', message: messageOf(error) }]);
            } finally {
              setBusy(false);
            }
          }}
        >
          Confirm void
        </Pill>
        <Pill variant="secondary" onClick={onClose}>
          Cancel
        </Pill>
      </div>
    </Dialog>
  );
}
