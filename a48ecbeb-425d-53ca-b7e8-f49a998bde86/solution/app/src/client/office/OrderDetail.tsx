import { Check, Clock, Mail, Undo2, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { trapKeys } from "../components/trap";
import { PriceTable } from "../crate/PriceTable";
import { api } from "../lib/api";
import type { Order, Refund, User } from "../lib/types";
import { dollars, FLAVOUR_NAMES, longDateTime, money, PROVINCE_NAMES } from "../../shared/format";
import { failureOf, Loading, OrderStatusBadge, PageFailure, parseDollars, useOfficeData } from "./shared";

// One order for staff: lines, totals, refunds with their split, and the refund and receipt actions.

const REFUND_POLL_MS = 2000;

interface Detail {
  order: Order;
  customer: { name: string; email: string };
}

const flavourName = (slug: string): string => FLAVOUR_NAMES[slug] ?? slug;

/** What the refund status says once billing has answered. */
const settledText = (refund: Refund): string =>
  refund.status === "applied" ? `Refund of ${money(refund.amount_cents)} confirmed.` : `Billing rejected the refund of ${money(refund.amount_cents)}.`;

function RefundBadge({ status }: { status: Refund["status"] }) {
  if (status === "applied") {
    return (
      <span className="badge badge-applied">
        <Check size={14} aria-hidden="true" />
        Applied
      </span>
    );
  }
  if (status === "rejected") {
    return (
      <span className="badge badge-rejected">
        <X size={14} aria-hidden="true" />
        Rejected
      </span>
    );
  }
  return (
    <span className="badge badge-pending">
      <Clock size={14} aria-hidden="true" />
      Pending confirmation
    </span>
  );
}

interface DialogProps {
  order: Order;
  onClose: () => void;
  onIssued: (refund: Refund, order: Order) => void;
  onOutage: (message: string) => void;
}

/** The refund form. One Idempotency-Key covers repeats of the same body until the server gives a final answer. */
function RefundDialog({ order, onClose, onIssued, onOutage }: DialogProps) {
  const headingId = useId();
  const amountId = useId();
  const reasonId = useId();
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState("");
  const [pending, setPending] = useState(false);
  const attempt = useRef<{ body: string; key: string } | null>(null);
  const amountInput = useRef<HTMLInputElement>(null);
  const reasonInput = useRef<HTMLInputElement>(null);

  useEffect(() => amountInput.current?.focus(), []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const body = { amount_cents: parseDollars(amount), reason };
    const text = JSON.stringify(body);
    if (attempt.current?.body !== text) attempt.current = { body: text, key: crypto.randomUUID() };
    setPending(true);
    setProblem("");
    try {
      const issued = await api<{ refund: Refund; order: Order }>("POST", `/api/staff/orders/${order.number}/refunds`, body, {
        "Idempotency-Key": attempt.current.key,
      });
      attempt.current = null;
      onIssued(issued.refund, issued.order);
    } catch (error) {
      const failure = failureOf(error);
      if (failure.status !== 503) attempt.current = null;
      const fields = failure.body.fields ?? {};
      setErrors(fields);
      if (fields.amount_cents) amountInput.current?.focus();
      else if (fields.reason) reasonInput.current?.focus();
      if (!failure.body.fields) setProblem(failure.message);
      if (failure.status === 503) onOutage(failure.message);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="dialog-backdrop">
      <div role="dialog" aria-modal="true" aria-labelledby={headingId} className="office-dialog" onKeyDown={(event) => trapKeys(event, onClose)}>
        <h2 id={headingId} data-dialog-heading>
          Refund order {order.number}
        </h2>
        <p className="muted">
          Left to refund <span className="num">{money(order.refundable_cents)}</span>
        </p>
        <form onSubmit={(event) => void submit(event)} noValidate>
          <div className="field">
            <label htmlFor={amountId}>Amount</label>
            <div className="amount-row">
              <input
                id={amountId}
                ref={amountInput}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                className="num"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                aria-invalid={errors.amount_cents ? true : undefined}
                aria-describedby={errors.amount_cents ? `${amountId}-error` : undefined}
              />
              <button type="button" className="btn btn-secondary" onClick={() => setAmount(dollars(order.refundable_cents))}>
                Refund everything left
              </button>
            </div>
            {errors.amount_cents && (
              <p id={`${amountId}-error`} className="field-error">
                {errors.amount_cents}
              </p>
            )}
          </div>
          <div className="field">
            <label htmlFor={reasonId}>Reason</label>
            <input
              id={reasonId}
              ref={reasonInput}
              type="text"
              value={reason}
              maxLength={500}
              onChange={(event) => setReason(event.target.value)}
              aria-invalid={errors.reason ? true : undefined}
              aria-describedby={errors.reason ? `${reasonId}-error` : undefined}
            />
            {errors.reason && (
              <p id={`${reasonId}-error`} className="field-error">
                {errors.reason}
              </p>
            )}
          </div>
          {problem && <p className="field-error">{problem}</p>}
          <div className="dialog-actions">
            <button type="button" className="btn btn-quiet" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={pending} aria-busy={pending}>
              <Undo2 size={18} aria-hidden="true" />
              Issue refund
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function OrderDetail({ number, user }: { number: string; user: User }) {
  const { data, setData, failure, reload } = useOfficeData<Detail>(`/api/staff/orders/${encodeURIComponent(number)}`);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [watching, setWatching] = useState<Refund | null>(null);
  const [resending, setResending] = useState(false);
  const refundButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  const supportDesk = user.role === "support" || user.role === "owner";

  useEffect(() => {
    if (open || !returnFocus.current) return;
    returnFocus.current = false;
    refundButton.current?.focus();
  }, [open]);

  // A pending refund is read back every 2 seconds until billing has confirmed or refused it.
  useEffect(() => {
    if (!watching) return;
    const timer = setInterval(() => void reload(), REFUND_POLL_MS);
    return () => clearInterval(timer);
  }, [watching, reload]);

  useEffect(() => {
    if (!watching || !data) return;
    const refund = data.order.refunds.find((r) => r.id === watching.id);
    if (!refund || refund.status === "pending_provider") return;
    setWatching(null);
    setStatus(settledText(refund));
  }, [data, watching]);

  const close = () => {
    returnFocus.current = true;
    setOpen(false);
  };

  const issued = (refund: Refund, order: Order) => {
    setData((prev) => prev && { ...prev, order });
    close();
    if (refund.status === "pending_provider") {
      setStatus(`Refund of ${money(refund.amount_cents)} sent to billing. Waiting for confirmation.`);
      setWatching(refund);
    } else {
      setStatus(settledText(refund));
    }
  };

  const resend = async () => {
    setResending(true);
    try {
      await api<{ queued: boolean }>("POST", `/api/staff/orders/${encodeURIComponent(number)}/resend-receipt`);
      setStatus("Receipt sent again.");
    } catch (error) {
      setStatus(failureOf(error).message);
    } finally {
      setResending(false);
    }
  };

  if (!data) {
    return (
      <div className="office-page">
        <h1 className="num">Order {number}</h1>
        {failure ? <PageFailure failure={failure} /> : <Loading />}
      </div>
    );
  }

  const { order, customer } = data;
  const ship = order.ship_to;
  return (
    <>
      <div className="office-page" inert={open}>
        <div className="order-head">
          <h1>
            Order <span className="num">{order.number}</span>
          </h1>
          <OrderStatusBadge status={order.status} />
        </div>
        <p className="muted">
          Placed <span className="num">{longDateTime(new Date(order.placed_at))}</span>
        </p>
        {supportDesk && (
          <div className="order-actions">
            <button ref={refundButton} type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
              <Undo2 size={18} aria-hidden="true" />
              Refund
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => void resend()} disabled={resending} aria-busy={resending}>
              <Mail size={18} aria-hidden="true" />
              Resend receipt
            </button>
          </div>
        )}
        <p role="status" aria-label="Refund status" className="status-line">
          {status}
        </p>
        <div className="office-grid">
          <section aria-labelledby="order-lines" className="panel span-8">
            <h2 id="order-lines">Lines</h2>
            <div className="table-wrap">
              <table className="office-table">
                <thead>
                  <tr>
                    <th scope="col">Flavour</th>
                    <th scope="col" className="figure">
                      Cans
                    </th>
                    <th scope="col" className="figure">
                      Goods
                    </th>
                    <th scope="col" className="figure">
                      Deposit
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {order.lines.map((line) => (
                    <tr key={line.flavour}>
                      <th scope="row">{flavourName(line.flavour)}</th>
                      <td className="num figure">{line.quantity}</td>
                      <td className="num figure">{money(line.goods_cents)}</td>
                      <td className="num figure">{money(line.deposit_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <PriceTable figures={order} subscribed={order.discount_cents > 0} hasCans />
            <dl className="facts">
              <div>
                <dt>Refunded</dt>
                <dd className="num">{money(order.refunded_cents)}</dd>
              </div>
              <div>
                <dt>Left to refund</dt>
                <dd className="num">{money(order.refundable_cents)}</dd>
              </div>
            </dl>
          </section>
          <section aria-labelledby="order-customer" className="panel span-4">
            <h2 id="order-customer">Customer</h2>
            <p>
              {customer.name}
              <br />
              <a href={`mailto:${customer.email}`}>{customer.email}</a>
            </p>
            <h3>Ship to</h3>
            <address>
              {ship.name}
              <br />
              {ship.line1}
              {ship.line2 && (
                <>
                  <br />
                  {ship.line2}
                </>
              )}
              <br />
              {ship.city}, {PROVINCE_NAMES[ship.province] ?? ship.province} <span className="num">{ship.postal_code}</span>
            </address>
          </section>
          <section aria-labelledby="order-refunds" className="panel span-12">
            <h2 id="order-refunds">Refunds</h2>
            {order.refunds.length === 0 ? (
              <p className="muted">No refunds on this order.</p>
            ) : (
              <ul className="refund-list">
                {order.refunds.map((refund) => (
                  <li key={refund.id} className="refund-item">
                    <div className="refund-head">
                      <span className="num refund-amount">{money(refund.amount_cents)}</span>
                      <RefundBadge status={refund.status} />
                      <span className="muted num">{longDateTime(new Date(refund.created_at))}</span>
                    </div>
                    <p>{refund.reason}</p>
                    <dl className="facts refund-split">
                      {refund.split.lines.map((line) => (
                        <div key={line.flavour}>
                          <dt>{flavourName(line.flavour)}</dt>
                          <dd className="num">
                            {money(line.goods_cents)} goods, {money(line.deposit_cents)} deposit
                          </dd>
                        </div>
                      ))}
                      <div>
                        <dt>Shipping</dt>
                        <dd className="num">{money(refund.split.shipping_cents)}</dd>
                      </div>
                      {refund.split.taxes.map((tax) => (
                        <div key={tax.name}>
                          <dt>{tax.name}</dt>
                          <dd className="num">{money(tax.cents)}</dd>
                        </div>
                      ))}
                    </dl>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
      {open && <RefundDialog order={order} onClose={close} onIssued={issued} onOutage={setStatus} />}
    </>
  );
}
