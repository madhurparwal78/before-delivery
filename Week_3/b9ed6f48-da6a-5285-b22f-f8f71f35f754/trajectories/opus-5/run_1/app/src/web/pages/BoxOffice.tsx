import { useState } from 'react';
import { api, ApiError, newIdempotencyKey } from '../lib/api.js';
import { useResource } from '../lib/hooks.js';
import { useStore } from '../lib/store.js';
import { Dialog, ErrorSummary } from '../components/Dialog.js';
import {
  SESSION_STATUS_LABELS,
  TIER_KEYS,
  TIER_NAMES,
  copy,
  differenceCell,
  messageFor,
  priceChangeNotice,
  refundIssuedNotice,
  sessionCancelledNotice,
  seatsLeftLine,
} from '../../shared/copy.js';
import { CURRENCIES, formatPrice, parseAmountToMinor, type Currency } from '../../shared/money.js';
import { formatDayKey, lisbonMonthKey, parseDayEntry, wallEntryToIso } from '../../shared/lisbon.js';
import type {
  AuditRow,
  GuidedSession,
  ManagerOrder,
  OverdueSupporter,
  ReconciliationRow,
} from '../../shared/types.js';

function NewSessionForm({ onCreated }: { onCreated: () => void }): JSX.Element {
  const { announce } = useStore();
  const [title, setTitle] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [duration, setDuration] = useState(60);
  const [capacity, setCapacity] = useState(12);
  const [message, setMessage] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  return (
    <form
      aria-label="New session"
      onSubmit={(event) => {
        event.preventDefault();
        setMessage(null);
        setFields({});
        const converted = wallEntryToIso(startsAt);
        if (converted.kind === 'skipped') {
          setFields({ starts_at: copy.skippedTime });
          return;
        }
        if (converted.kind === 'format') {
          setFields({ starts_at: copy.timeAfterNow });
          return;
        }
        void api('/api/manager/sessions', {
          method: 'POST',
          body: {
            title,
            starts_at: converted.iso,
            duration_minutes: duration,
            capacity,
          },
        })
          .then(() => {
            announce(copy.sessionCreated);
            onCreated();
          })
          .catch((error: unknown) => {
            if (error instanceof ApiError) {
              setMessage(error.message);
              setFields(error.fields);
            }
          });
      }}
    >
      <h3>New session</h3>
      <ErrorSummary
        message={message}
        fields={fields}
        fieldIds={{
          title: 'session-title',
          starts_at: 'session-start',
          duration_minutes: 'session-duration',
          capacity: 'session-capacity',
        }}
      />
      <div className="field">
        <label htmlFor="session-title">Title</label>
        <input
          id="session-title"
          type="text"
          aria-label="Title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        {fields.title ? <span className="field-error">{fields.title}</span> : null}
      </div>
      <div className="field">
        <label htmlFor="session-start">Starts at (Lisbon time)</label>
        <input
          id="session-start"
          type="text"
          aria-label="Starts at (Lisbon time)"
          placeholder="2026-11-14 18:30"
          value={startsAt}
          onChange={(event) => setStartsAt(event.target.value)}
        />
        {fields.starts_at ? <span className="field-error">{fields.starts_at}</span> : null}
      </div>
      <div className="field">
        <label htmlFor="session-duration">Duration in minutes</label>
        <input
          id="session-duration"
          type="number"
          aria-label="Duration in minutes"
          value={duration}
          onChange={(event) => setDuration(Number(event.target.value))}
        />
        {fields.duration_minutes ? <span className="field-error">{fields.duration_minutes}</span> : null}
      </div>
      <div className="field">
        <label htmlFor="session-capacity">Capacity</label>
        <input
          id="session-capacity"
          type="number"
          aria-label="Capacity"
          value={capacity}
          onChange={(event) => setCapacity(Number(event.target.value))}
        />
        {fields.capacity ? <span className="field-error">{fields.capacity}</span> : null}
      </div>
      <div className="inline-actions">
        <button type="submit">Create session</button>
      </div>
    </form>
  );
}

function CancelSessionDialog({
  session,
  onClose,
  onDone,
}: {
  session: GuidedSession;
  onClose: () => void;
  onDone: () => void;
}): JSX.Element {
  const { announce } = useStore();
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  return (
    <Dialog title="Cancel session" onClose={onClose}>
      <ErrorSummary message={message} fields={fields} fieldIds={{ reason: 'cancel-reason' }} />
      <div className="field">
        <label htmlFor="cancel-reason">Reason</label>
        <textarea
          id="cancel-reason"
          aria-label="Reason"
          rows={3}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
        {fields.reason ? <span className="field-error">{fields.reason}</span> : null}
      </div>
      <div className="inline-actions">
        <button
          type="button"
          onClick={() => {
            setMessage(null);
            setFields({});
            void api<{ refunds: number }>(`/api/manager/sessions/${session.id}/cancel`, {
              method: 'POST',
              body: { reason },
              idempotencyKey: newIdempotencyKey(),
            })
              .then((result) => {
                announce(sessionCancelledNotice(result.refunds));
                onDone();
                onClose();
              })
              .catch((error: unknown) => {
                if (error instanceof ApiError) {
                  setMessage(error.message);
                  setFields(error.fields);
                }
              });
          }}
        >
          Cancel session
        </button>
      </div>
    </Dialog>
  );
}

function RefundDialog({
  order,
  onClose,
  onDone,
}: {
  order: ManagerOrder;
  onClose: () => void;
  onDone: () => void;
}): JSX.Element {
  const { announce } = useStore();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  return (
    <Dialog title="Refund" onClose={onClose}>
      <ErrorSummary message={message} fields={fields} fieldIds={{ amount_minor: 'refund-amount', reason: 'refund-reason' }} />
      <div className="field">
        <label htmlFor="refund-amount">Amount</label>
        <input
          id="refund-amount"
          type="text"
          inputMode="decimal"
          aria-label="Amount"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
        {fields.amount_minor ? <span className="field-error">{fields.amount_minor}</span> : null}
      </div>
      <div className="field">
        <label htmlFor="refund-reason">Reason</label>
        <textarea
          id="refund-reason"
          aria-label="Reason"
          rows={3}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
        {fields.reason ? <span className="field-error">{fields.reason}</span> : null}
      </div>
      <div className="inline-actions">
        <button
          type="button"
          onClick={() => {
            setMessage(null);
            setFields({});
            const amountMinor = parseAmountToMinor(amount, order.currency);
            if (amountMinor === null) {
              setFields({ amount_minor: copy.amountFormat });
              return;
            }
            void api(`/api/manager/orders/${order.id}/refunds`, {
              method: 'POST',
              body: { amount_minor: amountMinor, reason },
              idempotencyKey: newIdempotencyKey(),
            })
              .then(() => {
                announce(refundIssuedNotice(amountMinor, order.currency));
                onDone();
                onClose();
              })
              .catch((error: unknown) => {
                if (error instanceof ApiError) {
                  setMessage(error.message);
                  setFields(error.fields);
                }
              });
          }}
        >
          Issue refund
        </button>
      </div>
    </Dialog>
  );
}

function NoteDialog({
  order,
  onClose,
  onDone,
}: {
  order: ManagerOrder;
  onClose: () => void;
  onDone: () => void;
}): JSX.Element {
  const { announce } = useStore();
  const [text, setText] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  return (
    <Dialog title="Add note" onClose={onClose}>
      <ErrorSummary message={message} fields={fields} fieldIds={{ text: 'note-text' }} />
      <div className="field">
        <label htmlFor="note-text">Note</label>
        <textarea
          id="note-text"
          aria-label="Note"
          rows={3}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        {fields.text ? <span className="field-error">{fields.text}</span> : null}
      </div>
      <div className="inline-actions">
        <button
          type="button"
          onClick={() => {
            setMessage(null);
            setFields({});
            void api(`/api/manager/orders/${order.id}/notes`, { method: 'POST', body: { text } })
              .then(() => {
                announce(copy.noteAdded);
                onDone();
                onClose();
              })
              .catch((error: unknown) => {
                if (error instanceof ApiError) {
                  setMessage(error.message);
                  setFields(error.fields);
                }
              });
          }}
        >
          Save note
        </button>
      </div>
    </Dialog>
  );
}

function PriceChangeForm(): JSX.Element {
  const { announce } = useStore();
  const [tier, setTier] = useState('fellow');
  const [currency, setCurrency] = useState<Currency>('EUR');
  const [price, setPrice] = useState('');
  const [effective, setEffective] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  return (
    <form
      aria-label="Price change"
      onSubmit={(event) => {
        event.preventDefault();
        setMessage(null);
        setFields({});
        const amountMinor = parseAmountToMinor(price, currency);
        if (amountMinor === null) {
          setFields({ amount_minor: copy.amountFormat });
          return;
        }
        const day = parseDayEntry(effective);
        if (day === null) {
          setFields({ effective_on: copy.dateAfterToday });
          return;
        }
        void api('/api/manager/plan-prices', {
          method: 'POST',
          body: { tier, currency, amount_minor: amountMinor, effective_on: day },
        })
          .then(() => announce(priceChangeNotice(formatDayKey(day))))
          .catch((error: unknown) => {
            if (error instanceof ApiError) {
              setMessage(error.message);
              setFields(error.fields);
            }
          });
      }}
    >
      <h3>Price change</h3>
      <ErrorSummary
        message={message}
        fields={fields}
        fieldIds={{ amount_minor: 'price-amount', effective_on: 'price-effective' }}
      />
      <div className="field">
        <label htmlFor="price-tier">Tier</label>
        <select id="price-tier" aria-label="Tier" value={tier} onChange={(event) => setTier(event.target.value)}>
          {TIER_KEYS.map((entry) => (
            <option key={entry} value={entry}>
              {TIER_NAMES[entry]}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="price-currency">Currency</label>
        <select
          id="price-currency"
          aria-label="Currency"
          value={currency}
          onChange={(event) => setCurrency(event.target.value as Currency)}
        >
          {CURRENCIES.map((entry) => (
            <option key={entry} value={entry}>
              {entry}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="price-amount">New price</label>
        <input
          id="price-amount"
          type="text"
          inputMode="decimal"
          aria-label="New price"
          value={price}
          onChange={(event) => setPrice(event.target.value)}
        />
        {fields.amount_minor ? <span className="field-error">{fields.amount_minor}</span> : null}
      </div>
      <div className="field">
        <label htmlFor="price-effective">Effective from</label>
        <input
          id="price-effective"
          type="text"
          aria-label="Effective from"
          placeholder="2026-12-01"
          value={effective}
          onChange={(event) => setEffective(event.target.value)}
        />
        {fields.effective_on ? <span className="field-error">{fields.effective_on}</span> : null}
      </div>
      <div className="inline-actions">
        <button type="submit">Schedule price change</button>
      </div>
    </form>
  );
}

export function BoxOffice(): JSX.Element {
  const { user } = useStore();
  const sessions = useResource<{ sessions: GuidedSession[] }>('/api/sessions');
  const orders = useResource<{ orders: ManagerOrder[] }>('/api/manager/orders');
  const dunning = useResource<{ overdue: OverdueSupporter[] }>('/api/manager/dunning');
  const audit = useResource<{ actions: AuditRow[] }>('/api/manager/audit');
  const [month, setMonth] = useState(() => lisbonMonthKey(Date.now()));
  const reconciliation = useResource<{ currencies: ReconciliationRow[] }>(
    `/api/manager/reconciliation?month=${month}`,
  );
  const [cancelling, setCancelling] = useState<GuidedSession | null>(null);
  const [refunding, setRefunding] = useState<ManagerOrder | null>(null);
  const [noting, setNoting] = useState<ManagerOrder | null>(null);

  if (!user || user.role !== 'manager') {
    return (
      <>
        <h1>Box office</h1>
        <p className="secondary">{messageFor('forbidden')}</p>
      </>
    );
  }

  const months = [0, 1, 2].map((back) => {
    const date = new Date();
    date.setUTCMonth(date.getUTCMonth() - back);
    return lisbonMonthKey(date.getTime());
  });

  return (
    <>
      <h1>Box office</h1>
      <div className="sections">
        <section>
          <h2>Sessions</h2>
          <div className="table-scroll">
            <table aria-label="Sessions">
              <thead>
                <tr>
                  <th scope="col">Session</th>
                  <th scope="col">Starts</th>
                  <th scope="col">Status</th>
                  <th scope="col">Seats</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(sessions.data?.sessions ?? []).map((session) => (
                  <tr key={session.id}>
                    <th scope="row">{session.title}</th>
                    <td className="readout">{session.starts_at_display}</td>
                    <td>{SESSION_STATUS_LABELS[session.status]}</td>
                    <td>{seatsLeftLine(session.seats_left)}</td>
                    <td>
                      {session.status === 'on_sale' || session.status === 'closed' ? (
                        <button type="button" onClick={() => setCancelling(session)}>
                          Cancel session
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <NewSessionForm onCreated={() => sessions.reload()} />
        </section>

        <section>
          <h2>Orders ledger</h2>
          <div className="table-scroll">
            <table aria-label="Ledger">
              <thead>
                <tr>
                  <th scope="col">Receipt</th>
                  <th scope="col">Buyer</th>
                  <th scope="col">Item</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Refunded</th>
                  <th scope="col">Status</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(orders.data?.orders ?? []).map((order) => (
                  <tr key={order.id}>
                    <th scope="row">{order.receipt_number}</th>
                    <td className="secondary">{order.user_email}</td>
                    <td>{order.description}</td>
                    <td className="figure">{formatPrice(order.amount_minor, order.currency)}</td>
                    <td className="figure">{formatPrice(order.refunded_minor, order.currency)}</td>
                    <td>{order.status}</td>
                    <td>
                      <div className="inline-actions">
                        <button type="button" onClick={() => setRefunding(order)}>
                          Refund
                        </button>
                        <button type="button" onClick={() => setNoting(order)}>
                          Add note
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2>Overdue supporters</h2>
          <div className="table-scroll">
            <table aria-label="Overdue supporters">
              <thead>
                <tr>
                  <th scope="col">Supporter</th>
                  <th scope="col">Tier</th>
                  <th scope="col">Due</th>
                  <th scope="col">Attempts</th>
                  <th scope="col">Next retry</th>
                </tr>
              </thead>
              <tbody>
                {(dunning.data?.overdue ?? []).map((row) => (
                  <tr key={row.user_email}>
                    <th scope="row">{row.user_email}</th>
                    <td>{TIER_NAMES[row.tier]}</td>
                    <td className="figure">{formatPrice(row.amount_due_minor, row.currency)}</td>
                    <td className="figure">{row.attempts}</td>
                    <td className="readout">{row.next_retry_at ?? 'None'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <PriceChangeForm />
        </section>

        <section>
          <h2>Reconciliation</h2>
          <div className="field">
            <label htmlFor="reconciliation-month">Month</label>
            <select
              id="reconciliation-month"
              aria-label="Month"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
            >
              {months.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
          </div>
          <div className="table-scroll">
            <table aria-label="Reconciliation">
              <thead>
                <tr>
                  <th scope="col">Currency</th>
                  <th scope="col">Ledger</th>
                  <th scope="col">Kill Bill</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {(reconciliation.data?.currencies ?? []).map((row) => (
                  <tr key={row.currency}>
                    <th scope="row">{row.currency}</th>
                    <td className="figure">{formatPrice(row.ledger_net_minor, row.currency)}</td>
                    <td className="figure">{formatPrice(row.killbill_net_minor, row.currency)}</td>
                    <td>
                      {row.matched
                        ? copy.reconciliationMatched
                        : differenceCell(row.difference_minor, row.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2>Staff actions</h2>
          <div className="table-scroll">
            <table aria-label="Staff actions">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Who</th>
                  <th scope="col">Action</th>
                  <th scope="col">Target</th>
                </tr>
              </thead>
              <tbody>
                {(audit.data?.actions ?? []).map((row) => (
                  <tr key={row.id}>
                    <td className="readout">{row.at}</td>
                    <td className="secondary">{row.actor_email}</td>
                    <td>{row.action}</td>
                    <td className="secondary">{row.target_id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {cancelling ? (
        <CancelSessionDialog
          session={cancelling}
          onClose={() => setCancelling(null)}
          onDone={() => {
            sessions.reload();
            orders.reload();
            audit.reload();
          }}
        />
      ) : null}
      {refunding ? (
        <RefundDialog
          order={refunding}
          onClose={() => setRefunding(null)}
          onDone={() => {
            orders.reload();
            audit.reload();
          }}
        />
      ) : null}
      {noting ? (
        <NoteDialog
          order={noting}
          onClose={() => setNoting(null)}
          onDone={() => {
            orders.reload();
            audit.reload();
          }}
        />
      ) : null}
    </>
  );
}
