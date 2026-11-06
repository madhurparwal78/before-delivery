import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { flavourName } from '../../../shared/catalogue.js';
import { refundCopy } from '../../../shared/copy.js';
import { formatCents, formatDollars, parseDollarsToCents } from '../../../shared/money.js';
import { taxLineLabel } from '../../../shared/quote.js';
import { formatLongDate } from '../../../shared/time.js';
import { ApiCallError, api, type OrderPayload } from '../api.js';
import { useShop } from '../state/shop.js';

const POLL_MS = 2_000;

function RefundDialog({
  order,
  onClose,
  onDone,
  setStatus,
}: {
  order: OrderPayload;
  onClose: () => void;
  onDone: () => void;
  setStatus: (message: string) => void;
}): ReactElement {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const panel = useRef<HTMLDivElement | null>(null);
  const amountField = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    amountField.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const container = panel.current;
      if (container === null) return;
      const focusable = [
        ...container.querySelectorAll<HTMLElement>('button, input, textarea'),
      ];
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const issue = async () => {
    setError('');
    const cents = parseDollarsToCents(amount);
    if (cents === null || cents < 1) {
      setError('Enter an amount in dollars, like 10.00.');
      return;
    }
    setStatus(refundCopy.pending(cents));
    try {
      await api.post(
        `/api/staff/orders/${order.number}/refunds`,
        { amount_cents: cents, reason },
        { 'idempotency-key': `refund-${crypto.randomUUID()}` },
      );
      onDone();
      onClose();
    } catch (caught) {
      if (!(caught instanceof ApiCallError)) throw caught;
      if (caught.failure.fields?.amount_cents !== undefined) {
        setError(caught.failure.fields.amount_cents);
      } else if (caught.failure.error === 'billing_unavailable') {
        setStatus(refundCopy.billingOutage);
        setError(refundCopy.billingOutage);
      } else setError(caught.failure.message);
      setStatus('');
    }
  };

  return (
    <div className="office__dialog-scrim">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Refund order ${order.number}`}
        className="office__dialog paper"
        ref={panel}
      >
        <h2>Refund order {order.number}</h2>
        <p className="mono">{formatDollars(order.refundable_cents)} left to refund</p>
        <div className="field">
          <label htmlFor="refund-amount">Amount</label>
          <input
            id="refund-amount"
            className="mono"
            ref={amountField}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
          {error === '' ? null : <p className="field__error">{error}</p>}
        </div>
        <div className="field">
          <label htmlFor="refund-reason">Reason</label>
          <input
            id="refund-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
        <div className="office__actions">
          <button
            type="button"
            className="button button--quiet"
            onClick={() => setAmount(formatCents(order.refundable_cents))}
          >
            Refund everything left
          </button>
          <button type="button" className="button button--primary" onClick={() => void issue()}>
            Issue refund
          </button>
          <button type="button" className="button button--quiet" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export function OrderDetail({ orderNumber }: { orderNumber: string }): ReactElement {
  const { user } = useShop();
  const [order, setOrder] = useState<OrderPayload | null>(null);
  const [customer, setCustomer] = useState<{ name: string; email: string } | null>(null);
  const [status, setStatus] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const refundButton = useRef<HTMLButtonElement | null>(null);

  const load = useCallback(async () => {
    try {
      const payload = await api.get<{
        order: OrderPayload;
        customer: { name: string; email: string };
      }>(`/api/staff/orders/${orderNumber}`);
      setOrder(payload.order);
      setCustomer(payload.customer);
      return payload.order;
    } catch {
      return null;
    }
  }, [orderNumber]);

  useEffect(() => {
    void load();
  }, [load]);

  const pendingRefund = order?.refunds.some((refund) => refund.status === 'pending_provider');

  useEffect(() => {
    if (pendingRefund !== true) return;
    const timer = window.setInterval(() => {
      void load().then((fresh) => {
        const applied = fresh?.refunds.find((refund) => refund.status === 'applied');
        if (applied !== undefined && fresh?.refunds.every((r) => r.status !== 'pending_provider')) {
          setStatus(refundCopy.applied(applied.amount_cents));
        }
      });
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [load, pendingRefund]);

  if (order === null) return <div className="office__content" />;

  const mayRefund = user?.role === 'support' || user?.role === 'owner';

  return (
    <div className="office__content">
      <h1 className="mono">{order.number}</h1>
      <p>
        {formatLongDate(order.placed_at.slice(0, 10))} &middot; {order.status} &middot;{' '}
        {order.refund_status}
      </p>
      {customer === null ? null : (
        <p>
          {customer.name} &middot; <span className="mono">{customer.email}</span>
        </p>
      )}

      <h2>Lines</h2>
      <table className="office__table mono" aria-label="Order lines">
        <thead>
          <tr>
            <th scope="col">Flavour</th>
            <th scope="col">Cans</th>
            <th scope="col">Goods</th>
            <th scope="col">Discount</th>
            <th scope="col">Deposit</th>
          </tr>
        </thead>
        <tbody>
          {order.lines.map((line) => (
            <tr key={line.flavour}>
              <th scope="row">{flavourName(line.flavour)}</th>
              <td>{line.quantity}</td>
              <td>{formatDollars(line.goods_cents)}</td>
              <td>{formatDollars(-line.discount_cents)}</td>
              <td>{formatDollars(line.deposit_cents)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Totals</h2>
      <table className="office__table mono" aria-label="Price breakdown">
        <tbody>
          <tr>
            <th scope="row">Subtotal</th>
            <td>{formatDollars(order.goods_cents)}</td>
          </tr>
          {order.discount_cents > 0 ? (
            <tr>
              <th scope="row">Subscribe &amp; save (10%)</th>
              <td>{formatDollars(-order.discount_cents)}</td>
            </tr>
          ) : null}
          <tr>
            <th scope="row">Deposit</th>
            <td>{formatDollars(order.deposit_cents)}</td>
          </tr>
          <tr>
            <th scope="row">Shipping</th>
            <td>{order.shipping_cents === 0 ? 'Free' : formatDollars(order.shipping_cents)}</td>
          </tr>
          {order.taxes.map((tax) => (
            <tr key={tax.name}>
              <th scope="row">{taxLineLabel(tax.name, tax.rate)}</th>
              <td>{formatDollars(tax.cents)}</td>
            </tr>
          ))}
          <tr>
            <th scope="row">Total</th>
            <td>{formatDollars(order.total_cents)}</td>
          </tr>
          <tr>
            <th scope="row">Refunded</th>
            <td>{formatDollars(order.refunded_cents)}</td>
          </tr>
          <tr>
            <th scope="row">Left to refund</th>
            <td>{formatDollars(order.refundable_cents)}</td>
          </tr>
        </tbody>
      </table>

      <h2>Refunds</h2>
      {order.refunds.length === 0 ? (
        <p>No refunds on this order.</p>
      ) : (
        <ul className="office__refunds">
          {order.refunds.map((refund) => (
            <li key={refund.id}>
              <span className="mono">{formatDollars(refund.amount_cents)}</span>
              <span>{refund.status}</span>
              <span>{refund.reason}</span>
              <ul>
                {refund.split.lines.map((line) => (
                  <li key={line.flavour} className="mono">
                    {flavourName(line.flavour)}: goods {formatDollars(line.goods_cents)}, deposit{' '}
                    {formatDollars(line.deposit_cents)}
                  </li>
                ))}
                <li className="mono">Shipping {formatDollars(refund.split.shipping_cents)}</li>
                {refund.split.taxes.map((tax) => (
                  <li key={tax.name} className="mono">
                    {tax.name} {formatDollars(tax.cents)}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      <div className="office__actions">
        {mayRefund ? (
          <button
            type="button"
            className="button button--primary"
            ref={refundButton}
            onClick={() => setDialogOpen(true)}
          >
            Refund
          </button>
        ) : null}
        {mayRefund ? (
          <button
            type="button"
            className="button button--quiet"
            onClick={() => {
              void api
                .post(`/api/staff/orders/${order.number}/resend-receipt`)
                .then(() => setStatus(refundCopy.receiptResent));
            }}
          >
            Resend receipt
          </button>
        ) : null}
        <a className="button button--quiet" href={order.invoice_url}>
          Invoice (PDF)
        </a>
        <a
          className="button button--quiet"
          href={`/api/staff/orders/${order.number}/packing-slip.pdf`}
          aria-label={`Packing slip for ${order.number}`}
        >
          Packing slip
        </a>
      </div>

      {dialogOpen ? (
        <RefundDialog
          order={order}
          setStatus={setStatus}
          onClose={() => {
            setDialogOpen(false);
            refundButton.current?.focus();
          }}
          onDone={() => void load()}
        />
      ) : null}

      <p role="status" aria-live="polite" aria-label="Refund status" className="live-region">
        {status}
      </p>
    </div>
  );
}
