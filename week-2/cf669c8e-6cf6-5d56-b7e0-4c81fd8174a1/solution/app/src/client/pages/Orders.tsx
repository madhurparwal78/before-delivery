import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Order, OrderState, Plan, Stage } from '../../shared/types.js';
import { ApiError, SessionEnded, get, newKey, patch, post } from '../api.js';
import { EmptyList } from '../components/EmptyList.js';
import { ErrorSummary, Field } from '../components/Form.js';
import { Money, type Word } from '../components/Money.js';
import { AllocationTable, KitLines, ScheduleTable } from '../components/OrderTables.js';
import { money } from '../format.js';
import { usePoll } from '../hooks.js';
import { Link, navigate } from '../router.js';
import { RESUME_KEY, useSession } from '../session.js';
import { NotFound } from './NotFound.js';

const CLOSED_STATES: OrderState[] = ['withdrawn', 'paid in full', 'kit dispatched', 'fitted', 'inspection passed'];
const SENT = 'Payment sent. Waiting for confirmation.';
const ARREARS = 'Order in arrears. The kit will not be dispatched until this clears.';
const KILLBILL_DOWN = 'Payments are paused. Nothing has been charged.';

const ERROR_COPY: Record<string, string> = {
  payment_in_flight: 'A payment is still pending. Try again once it settles.',
  refund_in_flight: 'A refund is still pending. Try again once it settles.',
  payments_paused: KILLBILL_DOWN,
  registry_unreachable: 'Plate registry unreachable. Your fit stays unconfirmed until it answers.',
  donor_changed: "This scooter's registration changed. Prove the fit again.",
  quote_changed: 'The inspection fee changed. Check the new total before paying.',
  fit_not_passed: 'Fit not proven. No deposit can be taken.',
  donor_unconfirmed: 'Donor unconfirmed. No deposit can be taken.',
  withdrawal_closed: 'The withdrawal period has ended.',
  stage_already_paid: 'That stage is already paid.',
  stage_out_of_order: 'Pay the earlier stage first.',
  illegal_transition: 'The order is not in a state where that can be done.',
};

function orderWord(order: Order): Word {
  if (order.state === 'quoted') return 'quoted';
  if (order.state === 'withdrawn') return 'returned';
  if (order.state === 'paid in full' || order.state === 'kit dispatched' || order.state === 'fitted' || order.state === 'inspection passed') return 'paid';
  return 'scheduled';
}

export function OrderList(): ReactNode {
  const { user, ready } = useSession();
  const [orders, setOrders] = useState<Order[] | null>(null);
  const resume = sessionStorage.getItem(RESUME_KEY);
  useEffect(() => { document.title = 'My orders · Ommezwaai Feeler'; }, []);
  useEffect(() => { if (ready && !user) navigate('/sign-in'); }, [ready, user]);
  usePoll(async () => { if (user) setOrders((await get<{ orders: Order[] }>('/api/orders', { poll: true })).orders); }, 3000, [user?.id]);
  return (
    <section className="page">
      <h1>My orders</h1>
      {resume ? <p><Link to={resume} className="btn">Resume your configuration</Link></p> : null}
      {orders === null ? <p className="hint">Loading...</p> : orders.length === 0 ? <EmptyList>No orders yet. Prove a fit first.</EmptyList> : (
        <table className="ruled-table" role="table" aria-label="Orders">
          <thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Order</th><th role="columnheader" scope="col">Kind</th><th role="columnheader" scope="col">State</th><th role="columnheader" scope="col">Total</th></tr></thead>
          <tbody role="rowgroup">
            {orders.map((o) => (
              <tr role="row" key={o.id}>
                <td role="cell" data-label="Order"><Link to={`/orders/${o.id}`}>Open order {o.number}</Link></td>
                <td role="cell" data-label="Kind">{o.kind === 'kit' ? 'Retrofit kit' : 'Built bike'}</td>
                <td role="cell" data-label="State">{o.state}</td>
                <td role="cell" data-label="Total"><Money cents={o.totalCents} word={orderWord(o)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** What the payment status region says about a change between two reads of the order. */
function paymentMessage(before: Order | null, after: Order): string | null {
  for (const stage of after.schedule) {
    const was = before?.schedule.find((s) => s.stage === stage.stage);
    if (was?.status === 'pending' && stage.status === 'paid') return `${stage.label} paid.`;
    if (was?.status === 'pending' && stage.status === 'failed') return `${stage.label} failed. Nothing was taken.`;
  }
  if (after.state === 'withdrawn' && before?.state !== 'withdrawn') return 'Order withdrawn.';
  if (after.state === 'in arrears' && before?.state !== 'in arrears') return ARREARS;
  if (after.schedule.some((s) => s.status === 'pending') && !before?.schedule.some((s) => s.status === 'pending')) return SENT;
  return null;
}

export function OrderPage({ id }: { id: string }): ReactNode {
  const { user, ready, providers } = useSession();
  const [order, setOrder] = useState<Order | null | undefined>(undefined);
  const [message, setMessage] = useState('');
  const previous = useRef<Order | null>(null);
  const keys = useRef<Record<string, string>>({});
  const statusRef = useRef<HTMLDivElement>(null);
  const [focusStatus, setFocusStatus] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (ready && !user) navigate('/sign-in'); }, [ready, user]);
  const accept = (next: Order): void => {
    const note = paymentMessage(previous.current, next);
    previous.current = next;
    for (const stage of next.schedule) if (stage.status === 'failed') delete keys.current[stage.stage];
    setOrder((was) => (was && JSON.stringify(was) === JSON.stringify(next) ? was : next));
    if (note) setMessage(note);
  };
  usePoll(async () => {
    if (!user) return;
    try {
      accept(await get<Order>(`/api/orders/${id}`, { poll: true }));
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 404) setOrder(null);
    }
  }, 2000, [id, user?.id]);
  useEffect(() => { if (order) document.title = `Order ${order.number} · Ommezwaai Feeler`; }, [order?.number]);
  useEffect(() => { if (focusStatus > 0) statusRef.current?.focus(); }, [focusStatus]);

  if (order === null) return <NotFound />;
  if (!order) return <section className="page"><p className="hint">Loading...</p></section>;

  const killbillDown = providers.killbill === 'down';
  const nextStage: Stage | undefined = CLOSED_STATES.includes(order.state) ? undefined : order.schedule.find((s) => s.status !== 'paid');
  const inFlight = order.schedule.some((s) => s.status === 'pending') || order.refunds.some((r) => r.status === 'pending');

  const act = async (run: () => Promise<Order>, success: (next: Order) => string, vanishes: boolean): Promise<void> => {
    setBusy(true);
    try {
      const next = await run();
      accept(next);
      setMessage(success(next));
      if (vanishes) setFocusStatus((n) => n + 1);
    } catch (caught) {
      if (caught instanceof SessionEnded) return;
      if (caught instanceof ApiError) {
        setMessage(ERROR_COPY[caught.code] ?? 'That did not go through. Nothing was changed.');
        if (caught.code === 'quote_changed' || caught.code === 'stage_already_paid') accept(await get<Order>(`/api/orders/${id}`, { poll: true }));
      }
    } finally {
      setBusy(false);
    }
  };

  const pay = (stage: Stage): void => {
    if (busy || killbillDown) return;
    keys.current[stage.stage] ??= newKey();
    void act(() => post<Order>(`/api/orders/${id}/payments`, { stage: stage.stage }, { key: keys.current[stage.stage] }), () => SENT, true);
  };
  const withdraw = (): void => {
    if (busy || killbillDown) return;
    keys.current['withdraw'] ??= newKey();
    void act(() => post<Order>(`/api/orders/${id}/withdraw`, {}, { key: keys.current['withdraw'] }), () => 'Order withdrawn.', true);
  };
  const switchFulfilment = (): void => {
    if (busy) return;
    keys.current['switch'] ??= newKey();
    void act(
      () => post<Order>(`/api/orders/${id}/switch-to-workshop`, {}, { key: keys.current['switch'] }),
      (next) => `Fulfilment changed to workshop fitting. VAT on paid stages corrected by ${money(next.schedule.reduce((s, x) => s + x.vatCorrectedCents, 0))}.`,
      true,
    );
  };

  const canSwitch = order.kind === 'kit' && order.config?.fulfilment === 'posted' && (order.state === 'deposit confirmed' || order.state === 'instalments running');
  return (
    <section className="page order-page">
      <div className="order-main">
        <p className="crumb"><Link to="/orders">My orders</Link></p>
        <h1>Order {order.number}</h1>
        <p className="lede">{order.kind === 'kit' ? `Retrofit kit for ${order.donor?.model ?? 'your scooter'}${order.donor?.plate ? ` · ${order.donor.plate}` : ''}` : 'Built e-moped'}{order.donor && !order.donor.confirmed ? ' · donor unconfirmed' : ''}</p>
        <h2>Kit lines</h2>
        <KitLines order={order} />
        <h2>Payment schedule</h2>
        <ScheduleTable stages={order.schedule} />
        <h2>Allocation</h2>
        <AllocationTable order={order} />
        {order.refunds.length ? (
          <>
            <h2>Refunds</h2>
            <ul className="refund-list">
              {order.refunds.map((r) => (
                <li key={r.id}>{order.lines.find((l) => l.id === r.lineId)?.name}: <Money cents={r.amountCents} word={r.status === 'failed' ? 'failed' : r.status === 'pending' ? 'pending' : r.status === 'returned' ? 'returned' : 'partly returned'} /></li>
              ))}
            </ul>
          </>
        ) : null}
        {order.deliveredOn ? <p>Delivered on <span className="num">{order.deliveredOn}</span>{order.withdrawalDeadline ? <>; withdrawal until <span className="num">{order.withdrawalDeadline}</span></> : null}.</p> : null}
        <ul className="notices">{order.notices.map((n) => <li key={n}>{n}</li>)}</ul>
      </div>
      <aside className="order-side ruled" aria-label="Order status and actions">
        <div className="state-card">
          <span className="label">State</span>
          <div role="status" aria-label="Order state" tabIndex={-1} className="state-line">{order.state}{order.partlyRefunded ? ', partly refunded' : ''}</div>
        </div>
        <div role="status" aria-label="Payment status" tabIndex={-1} ref={statusRef} className="payment-status">{message}</div>
        <div className="actions">
          {nextStage && !inFlight ? (
            <button type="button" className="btn primary" aria-disabled={killbillDown || busy} onClick={() => pay(nextStage)}>Pay {nextStage.label}</button>
          ) : null}
          {order.withdrawalOpen ? <button type="button" className="btn" aria-disabled={killbillDown || busy} onClick={withdraw}>Withdraw</button> : null}
          {canSwitch ? <button type="button" className="btn" aria-disabled={busy} onClick={switchFulfilment}>Switch to workshop fitting</button> : null}
        </div>
        <PlanPanel order={order} />
      </aside>
    </section>
  );
}

function PlanPanel({ order }: { order: Order }): ReactNode {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Plan>(order.plan);
  const [version, setVersion] = useState(order.planVersion);
  const [status, setStatus] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const toggle = (): void => {
    if (!open) {
      setDraft(order.plan);
      setVersion(order.planVersion);
      setStatus('');
      setErrors({});
    }
    setOpen(!open);
  };
  const set = (field: keyof Plan) => (value: string): void => setDraft((was) => ({ ...was, [field]: value }));
  const save = async (): Promise<void> => {
    setBusy(true);
    setErrors({});
    try {
      const saved = await patch<Order>(`/api/orders/${order.id}`, { planVersion: version, plan: draft }, { retryOnSession: true });
      setVersion(saved.planVersion);
      setStatus('Plan saved.');
    } catch (caught) {
      if (caught instanceof SessionEnded) return;
      if (caught instanceof ApiError && caught.code === 'stale_version') setStatus('This plan changed elsewhere. Your entries are kept; reload to see the latest.');
      else if (caught instanceof ApiError && caught.status === 422) { setErrors(caught.fields); setStatus('Check the fields and save again.'); }
      else setStatus('The plan could not be saved. Your entries are kept.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="plan">
      <button type="button" className="btn" aria-expanded={open} aria-controls="plan-panel" onClick={toggle}>Payment plan</button>
      {open ? (
        <section id="plan-panel" className="plan-panel ruled" aria-label="Payment plan">
          <ErrorSummary errors={errors} />
          <Field name="name" label="Name" error={errors['name']}>{(p) => <input {...p} type="text" value={draft.name} onChange={(e) => set('name')(e.target.value)} />}</Field>
          <Field name="street" label="Street" error={errors['street']}>{(p) => <input {...p} type="text" value={draft.street} onChange={(e) => set('street')(e.target.value)} />}</Field>
          <Field name="postcode" label="Postcode" error={errors['postcode']}>{(p) => <input {...p} type="text" value={draft.postcode} onChange={(e) => set('postcode')(e.target.value)} />}</Field>
          <Field name="city" label="City" error={errors['city']}>{(p) => <input {...p} type="text" value={draft.city} onChange={(e) => set('city')(e.target.value)} />}</Field>
          <Field name="note" label="Note to workshop" error={errors['note']}>{(p) => <textarea {...p} rows={3} value={draft.note ?? ''} onChange={(e) => set('note')(e.target.value)} />}</Field>
          <div className="row-actions"><button type="button" className="btn primary" aria-busy={busy} onClick={() => { void save(); }}>Save plan</button></div>
          <div role="status" aria-label="Plan status" className="plan-status">{status}</div>
        </section>
      ) : null}
    </div>
  );
}
