import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { Bike, DeskOrder, PlateRecord, Refund, Ride } from '../../shared/types.js';
import { ApiError, SessionEnded, get, newKey, post } from '../api.js';
import { EmptyList } from '../components/EmptyList.js';
import { Money, type Word } from '../components/Money.js';
import { AllocationTable, KitLines, ScheduleTable, stageWord } from '../components/OrderTables.js';
import { money } from '../format.js';
import { usePoll } from '../hooks.js';
import { Link, navigate } from '../router.js';
import { useSession } from '../session.js';
import { NotFound } from './NotFound.js';

function useFitterGate(): 'wait' | 'ok' | 'denied' {
  const { user, ready } = useSession();
  useEffect(() => { if (ready && !user) navigate('/sign-in'); }, [ready, user]);
  if (!ready || !user) return 'wait';
  return user.role === 'fitter' ? 'ok' : 'denied';
}

export function Desk(): ReactNode {
  const gate = useFitterGate();
  const { today } = useSession();
  const [date, setDate] = useState('');
  const [touched, setTouched] = useState(false);
  const [bikes, setBikes] = useState<Bike[]>([]);
  const [bikeId, setBikeId] = useState('');
  const [times, setTimes] = useState('');
  const [rides, setRides] = useState<Ride[] | null>(null);
  const [waiting, setWaiting] = useState<DeskOrder[] | null>(null);
  const [message, setMessage] = useState('');
  const [timesError, setTimesError] = useState('');
  const [dateError, setDateError] = useState('');
  const status = useRef<HTMLDivElement>(null);
  const [focusStatus, setFocusStatus] = useState(0);
  const dateRef = useRef(date);
  dateRef.current = date;

  useEffect(() => { document.title = 'Desk · Ommezwaai Feeler'; }, []);
  useEffect(() => { if (!touched && today) setDate(today); }, [today, touched]);
  useEffect(() => {
    if (gate !== 'ok') return;
    get<{ bikes: Bike[] }>('/api/bikes', { poll: true }).then((r) => { setBikes(r.bikes); setBikeId((was) => was || r.bikes[0]?.id || ''); }, () => undefined);
  }, [gate]);
  useEffect(() => { if (focusStatus > 0) status.current?.focus(); }, [focusStatus]);

  const loadRides = async (day: string): Promise<void> => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      setDateError(day ? 'Enter a date as YYYY-MM-DD.' : '');
      return;
    }
    setDateError('');
    const r = await get<{ rides: Ride[] }>(`/api/desk/rides?date=${day}`, { poll: true });
    if (dateRef.current === day) setRides((was) => (JSON.stringify(was) === JSON.stringify(r.rides) ? was : r.rides));
  };
  usePoll(async () => { if (gate === 'ok' && date) await loadRides(date); }, 2000, [gate, date]);
  usePoll(async () => {
    if (gate !== 'ok') return;
    const { orders } = await get<{ orders: DeskOrder[] }>('/api/desk/orders', { poll: true });
    const next = orders.filter((o) => o.schedule.some((s) => s.status === 'pending') || o.refunds.some((r) => r.status === 'pending'));
    setWaiting((was) => (JSON.stringify(was) === JSON.stringify(next) ? was : next));
  }, 2000, [gate]);

  if (gate === 'denied') return <NotFound />;
  if (gate === 'wait') return <section className="page"><p className="hint">Loading...</p></section>;

  const openSlots = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setTimesError('');
    const list = times.split(',').map((t) => t.trim()).filter(Boolean);
    try {
      const { slots } = await post<{ slots: unknown[] }>('/api/desk/ride-days', { bikeId, date, times: list });
      setMessage(`Opened ${slots.length} slots.`);
    } catch (caught) {
      if (caught instanceof SessionEnded) return;
      if (caught instanceof ApiError && caught.code === 'slot_exists') setMessage('Those slots already exist.');
      else if (caught instanceof ApiError && caught.status === 422) { setTimesError(caught.fields['times'] ?? ''); setDateError(caught.fields['date'] ?? ''); setMessage(caught.fields['times'] ?? caught.fields['date'] ?? 'Check the date and times.'); }
      else setMessage('The slots could not be opened.');
    }
  };
  const outcome = async (ride: Ride, result: 'ridden' | 'no-show'): Promise<void> => {
    try {
      await post<Ride>(`/api/desk/rides/${ride.id}/outcome`, { outcome: result });
      setMessage(result === 'ridden' ? 'Marked ridden.' : 'Marked no-show.');
      await loadRides(date);
      setFocusStatus((n) => n + 1);
    } catch (caught) {
      if (caught instanceof SessionEnded) return;
      setMessage(caught instanceof ApiError && caught.code === 'ride_not_started' ? 'This ride has not started yet.' : 'The outcome could not be marked.');
    }
  };

  return (
    <section className="page desk-page">
      <h1>Desk</h1>
      <div className="desk-grid">
        <div className="desk-day">
          <h2>Ride day</h2>
          <form className="desk-form ruled" onSubmit={(e) => { void openSlots(e); }} aria-label="Open slots">
            <div className="field" data-invalid={Boolean(dateError)}>
              <label htmlFor="ride-date">Ride date</label>
              <input id="ride-date" type="text" role="textbox" inputMode="numeric" placeholder="YYYY-MM-DD" value={date} aria-invalid={Boolean(dateError)}
                onChange={(e) => { setTouched(true); setDate(e.target.value); }} />
              {dateError ? <p className="field-error">{dateError}</p> : null}
            </div>
            <div className="field">
              <label htmlFor="ride-bike">Bike</label>
              <select id="ride-bike" value={bikeId} onChange={(e) => setBikeId(e.target.value)}>
                {bikes.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div className="field" data-invalid={Boolean(timesError)}>
              <label htmlFor="slot-times">Slot times</label>
              <input id="slot-times" type="text" role="textbox" placeholder="10:00, 13:00" value={times} aria-invalid={Boolean(timesError)} onChange={(e) => setTimes(e.target.value)} />
              {timesError ? <p className="field-error">{timesError}</p> : null}
            </div>
            <button type="submit" className="btn primary">Open slots</button>
          </form>
          <div role="status" aria-label="Desk status" tabIndex={-1} ref={status} className="desk-status">{message}</div>
          {rides === null ? <p className="hint">Loading...</p> : rides.length === 0 ? <EmptyList>No test rides on this day.</EmptyList> : (
            <table className="ruled-table" role="table" aria-label="Ride day">
              <thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Time</th><th role="columnheader" scope="col">Rider</th><th role="columnheader" scope="col">Bike</th><th role="columnheader" scope="col">State</th><th role="columnheader" scope="col">Outcome</th></tr></thead>
              <tbody role="rowgroup">
                {rides.map((r) => (
                  <tr role="row" key={r.id}>
                    <td role="cell" data-label="Time" className="num">{r.localTime}</td>
                    <td role="cell" data-label="Rider">{r.riderName}</td>
                    <td role="cell" data-label="Bike">{r.bikeName ?? r.bikeId}</td>
                    <td role="cell" data-label="State">{r.state}</td>
                    <td role="cell" data-label="Outcome">
                      {r.state === 'confirmed' ? (
                        <span className="row-actions">
                          <button type="button" className="btn" onClick={() => { void outcome(r, 'ridden'); }}>Mark ridden</button>
                          <button type="button" className="btn" onClick={() => { void outcome(r, 'no-show'); }}>Mark no-show</button>
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="desk-waiting">
          <h2>Payments waiting</h2>
          {waiting === null ? <p className="hint">Loading...</p> : waiting.length === 0 ? <EmptyList>No payments waiting on the provider.</EmptyList> : (
            <table className="ruled-table" role="table" aria-label="Payments waiting">
              <thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Order</th><th role="columnheader" scope="col">Rider</th><th role="columnheader" scope="col">Waiting on</th></tr></thead>
              <tbody role="rowgroup">
                {waiting.map((o) => (
                  <tr role="row" key={o.id}>
                    <td role="cell" data-label="Order"><Link to={`/desk/orders/${o.id}`}>Open order {o.number}</Link></td>
                    <td role="cell" data-label="Rider">{o.riderName}</td>
                    <td role="cell" data-label="Waiting on">{o.schedule.some((s) => s.status === 'pending') ? 'a payment' : 'a refund'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </section>
  );
}

const AMOUNT = /^\d+(\.\d{1,2})?$/;

function refundMessage(refund: Refund): string {
  const amount = money(refund.amountCents);
  if (refund.status === 'pending') return `Refund of ${amount} sent. Pending until the provider confirms.`;
  if (refund.status === 'returned') return `Refund of ${amount} returned.`;
  if (refund.status === 'partly returned') return `Refund of ${amount} partly returned. ${money(refund.returnedCents)} returned, ${money(refund.failedCents)} failed.`;
  return `Refund of ${amount} failed. Nothing was returned.`;
}

const REFUND_ERRORS: Record<string, string> = {
  payment_in_flight: 'A payment is still pending. Try again once it settles.',
  fee_already_spent: 'The inspection fee has been passed on and cannot be refunded.',
  payments_paused: 'Payments are paused. Nothing has been charged.',
  illegal_transition: 'No money can be refunded on this order in its current state.',
};

export function DeskOrderPage({ id }: { id: string }): ReactNode {
  const gate = useFitterGate();
  const { providers, today } = useSession();
  const [order, setOrder] = useState<DeskOrder | null | undefined>(undefined);
  const [lineId, setLineId] = useState('');
  const [amount, setAmount] = useState('');
  const [amountError, setAmountError] = useState('');
  const [refundMessageText, setRefundMessage] = useState('');
  const [paymentMessage, setPaymentMessage] = useState('');
  const [inspectionMessage, setInspectionMessage] = useState('');
  const [deliveredOn, setDeliveredOn] = useState('');
  const [deliveredError, setDeliveredError] = useState('');
  const [busy, setBusy] = useState(false);
  const tracked = useRef<string>('');
  const stateRef = useRef<HTMLDivElement>(null);
  const inspectionRef = useRef<HTMLDivElement>(null);
  const [focus, setFocus] = useState<{ target: 'state' | 'inspection'; n: number }>({ target: 'state', n: 0 });

  const accept = (next: DeskOrder): void => {
    setOrder((was) => (was && JSON.stringify(was) === JSON.stringify(next) ? was : next));
    setLineId((was) => was || next.lines[0]?.id || '');
    const refund = next.refunds.find((r) => r.id === tracked.current);
    if (refund) setRefundMessage(refundMessage(refund));
  };
  usePoll(async () => {
    if (gate !== 'ok') return;
    try {
      accept(await get<DeskOrder>(`/api/desk/orders/${id}`, { poll: true }));
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 404) setOrder(null);
    }
  }, 2000, [id, gate]);
  useEffect(() => { if (today && !deliveredOn) setDeliveredOn(today); }, [today, deliveredOn]);
  useEffect(() => {
    if (focus.n > 0) (focus.target === 'state' ? stateRef : inspectionRef).current?.focus();
  }, [focus]);
  useEffect(() => { if (order) document.title = `Desk · ${order.number} · Ommezwaai Feeler`; }, [order?.number]);

  if (gate === 'denied' || order === null) return <NotFound />;
  if (gate === 'wait' || !order) return <section className="page"><p className="hint">Loading...</p></section>;

  const killbillDown = providers.killbill === 'down';
  const refresh = async (): Promise<void> => accept(await get<DeskOrder>(`/api/desk/orders/${id}`, { poll: true }));

  const refund = async (): Promise<void> => {
    if (killbillDown || busy) return;
    if (!AMOUNT.test(amount)) { setAmountError('Enter an amount like 12.50.'); return; }
    setAmountError('');
    const [euros, cents = ''] = amount.split('.');
    const total = Number(euros) * 100 + Number(cents.padEnd(2, '0'));
    setBusy(true);
    try {
      const next = await post<DeskOrder>(`/api/desk/orders/${id}/refunds`, { lineId, amountCents: total }, { key: newKey() });
      const made = next.refunds.filter((r) => !order.refunds.some((o) => o.id === r.id)).at(-1) ?? next.refunds.at(-1);
      tracked.current = made?.id ?? '';
      accept(await get<DeskOrder>(`/api/desk/orders/${id}`, { poll: true }));
      if (made) setRefundMessage(refundMessage(made));
    } catch (caught) {
      if (caught instanceof SessionEnded) return;
      if (caught instanceof ApiError && caught.status === 422) setAmountError(caught.fields['amountCents'] ?? 'Check the amount.');
      else if (caught instanceof ApiError) setRefundMessage(REFUND_ERRORS[caught.code] ?? 'The refund could not be requested.');
    } finally {
      setBusy(false);
    }
  };
  const move = async (to: 'kit dispatched' | 'fitted'): Promise<void> => {
    try {
      await post(`/api/desk/orders/${id}/transitions`, { to });
      setPaymentMessage('');
      await refresh();
      setFocus((f) => ({ target: 'state', n: f.n + 1 }));
    } catch (caught) {
      if (caught instanceof SessionEnded) return;
      setPaymentMessage(caught instanceof ApiError && caught.code === 'in_arrears' ? 'Order in arrears. The kit will not be dispatched until this clears.' : 'That move is not allowed from this state.');
    }
  };
  const delivered = async (): Promise<void> => {
    setDeliveredError('');
    try {
      await post(`/api/desk/orders/${id}/delivered`, { deliveredOn });
      await refresh();
      setFocus((f) => ({ target: 'state', n: f.n + 1 }));
    } catch (caught) {
      if (caught instanceof SessionEnded) return;
      setDeliveredError(caught instanceof ApiError && caught.status === 422 ? (caught.fields['deliveredOn'] ?? 'Check the date.') : 'The delivery could not be recorded.');
    }
  };
  const inspect = async (): Promise<void> => {
    try {
      await post(`/api/desk/orders/${id}/inspection`);
      setInspectionMessage('Inspection recorded. Fit the new plate before riding.');
      await refresh();
      setFocus((f) => ({ target: 'inspection', n: f.n + 1 }));
    } catch (caught) {
      if (caught instanceof SessionEnded) return;
      if (caught instanceof ApiError && caught.code === 'registry_not_updated' && order.donor) {
        const read = await post<PlateRecord>('/api/plates/lookup', { plate: order.donor.plate, country: order.donor.country }, { poll: true }).catch(() => null);
        setInspectionMessage(`The registry still shows ${read?.className ?? 'the old class'}. Inspection not recorded.`);
      } else if (caught instanceof ApiError && caught.code === 'registry_unreachable') {
        setInspectionMessage('Plate registry unreachable. Inspection not recorded.');
      } else {
        setInspectionMessage('The inspection could not be recorded from this state.');
      }
    }
  };

  const draws = order.refunds.flatMap((r) => r.draws.map((d) => ({ refund: r, draw: d })));
  const posted = order.config?.fulfilment === 'posted';
  return (
    <section className="page order-page desk-order">
      <div className="order-main">
        <p className="crumb"><Link to="/desk">Desk</Link></p>
        <h1>Order {order.number}</h1>
        <p className="lede">{order.riderName} · {order.kind === 'kit' ? 'retrofit kit' : 'built bike'}{order.donor?.plate ? ` · ${order.donor.plate}` : ''}</p>
        <h2>Payments</h2>
        <table className="ruled-table" role="table" aria-label="Payments">
          <thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Item</th><th role="columnheader" scope="col">Stage</th><th role="columnheader" scope="col">Amount</th><th role="columnheader" scope="col">Kill Bill payment</th></tr></thead>
          <tbody role="rowgroup">
            {order.payments.map((p) => (
              <tr role="row" key={p.stage}>
                <td role="cell" data-label="Item">Payment</td>
                <td role="cell" data-label="Stage">{order.schedule.find((s) => s.stage === p.stage)?.label}</td>
                <td role="cell" data-label="Amount"><Money cents={p.amountCents} word={stageWord(p.status)} /></td>
                <td role="cell" data-label="Kill Bill payment" className="num small">{p.killbillPaymentId ?? 'not sent'}</td>
              </tr>
            ))}
            {draws.map(({ refund: r, draw }, i) => {
              const word: Word = draw.status === 'returned' ? 'returned' : draw.status === 'failed' ? 'failed' : 'pending';
              return (
                <tr role="row" key={`${r.id}-${i}`}>
                  <td role="cell" data-label="Item">Refund draw: {order.lines.find((l) => l.id === r.lineId)?.name}</td>
                  <td role="cell" data-label="Stage">{order.schedule.find((s) => s.stage === draw.stage)?.label}</td>
                  <td role="cell" data-label="Amount"><Money cents={draw.amountCents} word={word} /></td>
                  <td role="cell" data-label="Kill Bill payment" className="num small">{draw.killbillPaymentId ?? 'not sent'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <h2>Kit lines</h2>
        <KitLines order={order} />
        <h2>Payment schedule</h2>
        <ScheduleTable stages={order.schedule} />
        <h2>Allocation</h2>
        <AllocationTable order={order} />
      </div>
      <aside className="order-side ruled" aria-label="Order actions">
        <div className="state-card">
          <span className="label">State</span>
          <div role="status" aria-label="Order state" tabIndex={-1} ref={stateRef} className="state-line">{order.state}{order.partlyRefunded ? ', partly refunded' : ''}</div>
        </div>
        <div role="status" aria-label="Payment status" tabIndex={-1} className="payment-status">{paymentMessage}</div>
        <div className="actions">
          {order.state === 'paid in full' && posted ? <button type="button" className="btn primary" onClick={() => { void move('kit dispatched'); }}>Mark dispatched</button> : null}
          {order.state === 'paid in full' && !posted ? <button type="button" className="btn primary" onClick={() => { void move('fitted'); }}>Mark fitted</button> : null}
          {order.state === 'kit dispatched' && !order.deliveredOn ? (
            <div className="field" data-invalid={Boolean(deliveredError)}>
              <label htmlFor="delivered-on">Delivered on</label>
              <input id="delivered-on" type="text" role="textbox" inputMode="numeric" value={deliveredOn} onChange={(e) => setDeliveredOn(e.target.value)} aria-invalid={Boolean(deliveredError)} />
              {deliveredError ? <p className="field-error">{deliveredError}</p> : null}
              <button type="button" className="btn" onClick={() => { void delivered(); }}>Mark delivered</button>
            </div>
          ) : null}
          {order.kind === 'kit' && order.state === 'kit dispatched' && order.deliveredOn ? <p>Delivered on <span className="num">{order.deliveredOn}</span></p> : null}
          {order.classMove && (order.state === 'kit dispatched' || order.state === 'fitted') ? <button type="button" className="btn" onClick={() => { void inspect(); }}>Record inspection</button> : null}
        </div>
        {order.classMove ? <div role="status" aria-label="Inspection status" tabIndex={-1} ref={inspectionRef} className="inspection-status">{inspectionMessage}</div> : null}
        <form className="refund-form ruled" onSubmit={(e) => { e.preventDefault(); void refund(); }} aria-label="Refund a line">
          <div className="field">
            <label htmlFor="refund-line">Refund line</label>
            <select id="refund-line" value={lineId} onChange={(e) => setLineId(e.target.value)}>
              {order.lines.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          <div className="field" data-invalid={Boolean(amountError)}>
            <label htmlFor="refund-amount">Refund amount in euros</label>
            <input id="refund-amount" type="text" role="textbox" inputMode="decimal" value={amount} aria-invalid={Boolean(amountError)} onChange={(e) => setAmount(e.target.value)} />
            {amountError ? <p className="field-error">{amountError}</p> : null}
          </div>
          <button type="submit" className="btn primary" aria-disabled={killbillDown || busy}>Refund line</button>
          <div role="status" aria-label="Refund status" className="refund-status">{refundMessageText}</div>
        </form>
      </aside>
    </section>
  );
}
