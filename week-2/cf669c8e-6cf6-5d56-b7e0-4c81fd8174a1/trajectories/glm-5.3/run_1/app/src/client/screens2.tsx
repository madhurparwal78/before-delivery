import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChild } from 'preact';
import { api, ApiError, formatCents } from './api';
import type { Bike, Ride, Slot, Order, ScenePart, Catalogue } from './types';
import { OutageBanner, useProviders } from './shared';
import { MopedScene, storyOffsetsFor } from './scene';
import { drawStill } from './still';

const STORY_CAPTIONS = ['Body panels off', 'Footboard out', 'Petrol out', 'Hub on its axle line', 'Pack on its rail', 'Controller and harness'];

// ---- Bikes ----------------------------------------------------------------

export function BikesList(): ComponentChild {
  const [filter, setFilter] = useState<'all' | '25' | '45'>('all');
  const [bikes, setBikes] = useState<Bike[]>([]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const cls = params.get('class');
    setFilter(cls === '25' || cls === '45' ? cls : 'all');
  }, [window.location.search]);
  useEffect(() => {
    const q = filter === 'all' ? '' : `?class=${filter}`;
    const target = `/bikes${q}`;
    if (window.location.pathname + window.location.search !== target) {
      history.pushState(null, '', target);
    }
    void api<{ bikes: Bike[] }>('GET', `/api/bikes${q}`).then((r) => setBikes(r.bikes));
  }, [filter]);
  return (
    <main class="narrow">
      <h1>Built e-mopeds</h1>
      <OutageBanner />
      <fieldset>
        <legend>Road class filter</legend>
        <div role="radiogroup" aria-label="Road class filter">
          <label><input type="radio" name="class-filter" checked={filter === 'all'} onChange={() => setFilter('all')} /> All</label>
          <label><input type="radio" name="class-filter" checked={filter === '25'} onChange={() => setFilter('25')} /> <span class="class-mark c25" />25 km/h</label>
          <label><input type="radio" name="class-filter" checked={filter === '45'} onChange={() => setFilter('45')} /> <span class="class-mark c45" />45 km/h</label>
        </div>
      </fieldset>
      <table class="ruled" aria-label="Bike comparison">
        <thead><tr><th>Bike</th><th>Class</th><th class="num">Range km</th><th class="num">Gross</th><th></th></tr></thead>
        <tbody>
          {bikes.map((b) => (
            <tr key={b.id}>
              <td>{b.name}</td>
              <td><span class={`class-mark ${b.roadClass === 25 ? 'c25' : 'c45'}`} />{b.roadClass} km/h</td>
              <td class="num">{b.rangeKm}</td>
              <td class="num">{formatCents(b.grossCents)} <span class="status-word">quoted</span></td>
              <td><a href={`/bikes/${b.id}`} data-route>Open</a></td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}

export function BikePage({ bikeId }: { bikeId: string }): ComponentChild {
  const [bike, setBike] = useState<Bike | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [message, setMessage] = useState('');
  const [rideId, setRideId] = useState<string | null>(null);
  useEffect(() => {
    void api<{ bikes: Bike[] }>('GET', '/api/bikes').then((r) => setBike(r.bikes.find((b) => b.id === bikeId) ?? null));
    const loadSlots = () => void api<{ slots: Slot[] }>('GET', `/api/bikes/${bikeId}/slots`).then((r) => setSlots(r.slots));
    void loadSlots();
    const t = setInterval(loadSlots, 3000);
    return () => clearInterval(t);
  }, [bikeId]);

  const hold = async (slot: Slot) => {
    try {
      const ride = await api<Ride>('POST', '/api/test-rides/holds', { slotId: slot.id });
      setRideId(ride.id);
      setMessage(`Hold ends in ${Math.ceil(ride.remainingSeconds / 60)} min.`);
    } catch (e) {
      if (e instanceof ApiError) {
        const code = e.body.error ?? '';
        if (code === 'hold_exists') setMessage('You already hold a slot. Confirm it or let it run out.');
        else if (code === 'same_day_closed') setMessage('Same-day booking closed at 12:00.');
        else if (code === 'slot_gone') setMessage('That slot has just gone. Pick another.');
        else if (e.status === 401) { window.dispatchEvent(new CustomEvent('sign-again')); }
      }
    }
  };

  const confirm = async () => {
    if (!rideId) return;
    try {
      await api<Ride>('POST', `/api/test-rides/${rideId}/confirm`, {});
      window.location.href = `/rides/${rideId}`;
    } catch (e) {
      if (e instanceof ApiError && e.body.error === 'hold_expired') setMessage('Your hold ran out. The slot is free again.');
    }
  };

  return (
    <main class="narrow">
      <h1>{bike?.name ?? 'Bike'}</h1>
      <OutageBanner />
      {bike ? (
        <p>
          <span class={`class-mark ${bike.roadClass === 25 ? 'c25' : 'c45'}`} />{bike.roadClass} km/h class · {bike.rangeKm} km range · {formatCents(bike.grossCents)} <span class="status-word">quoted</span>
        </p>
      ) : null}
      <p role="status" aria-live="polite" aria-label="Test-ride hold" class="status-line">{message}</p>
      <h2>Slots</h2>
      <ul role="list" aria-label="Slots" style="list-style:none; padding:0">
        {slots.map((s) => (
          <li key={s.id} class="price-line">
            <span class="num">{s.localDate} {s.localTime}</span>
            <span>
              {s.status === 'free' ? <button onClick={() => { void hold(s); }}>{`Hold ${s.localDate} ${s.localTime}`}</button> : <span>{s.status} <span class="status-word">{s.status === 'booked' ? 'booked' : 'pending'}</span></span>}
            </span>
          </li>
        ))}
      </ul>
      {rideId ? <button class="primary" onClick={() => { void confirm(); }}>Confirm ride</button> : null}
      <h2>Leave a deposit</h2>
      <p><a href={`/bikes/${bikeId}/deposit`} data-route>Start checkout for this bike</a></p>
    </main>
  );
}

// ---- Rides ----------------------------------------------------------------

export function RidesList(): ComponentChild {
  const [rides, setRides] = useState<Ride[] | null>(null);
  const [message, setMessage] = useState('');
  const load = async () => {
    try {
      const r = await api<{ rides: Ride[] }>('GET', '/api/test-rides');
      setRides(r.rides);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return;
    }
  };
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, []);
  const cancel = async (ride: Ride) => {
    try {
      await api<Ride>('POST', `/api/test-rides/${ride.id}/cancel`, {});
      setMessage('');
      await load();
    } catch (e) {
      if (e instanceof ApiError) {
        const code = e.body.error ?? '';
        if (code === 'cancellation_closed') setMessage('Free cancellation has closed for this ride.');
        else if (e.status === 401) window.dispatchEvent(new CustomEvent('sign-again'));
      }
    }
  };
  return (
    <main class="narrow">
      <h1>My rides</h1>
      <OutageBanner />
      <p role="status" aria-live="polite" aria-label="Ride status" tabindex={-1} class="status-line">{message}</p>
      {rides === null ? <p role="status">Loading…</p> : rides.length === 0 ? <p class="empty-note" role="status">No test rides booked.</p> : (
        <table class="ruled" aria-label="Rides">
          <thead><tr><th>Date</th><th>Time</th><th>Bike</th><th>State</th><th></th></tr></thead>
          <tbody>
            {rides.map((r) => (
              <tr key={r.id}>
                <td class="num">{r.localDate}</td>
                <td class="num">{r.localTime}</td>
                <td>{r.bikeName ?? r.bikeId}</td>
                <td>{r.state}</td>
                <td>
                  <a href={`/rides/${r.id}`} data-route>Open</a>
                  {r.state === 'confirmed' && r.freeCancellation ? <button onClick={() => { void cancel(r); }}>Cancel ride</button> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}

export function RidePage({ rideId }: { rideId: string }): ComponentChild {
  const [ride, setRide] = useState<Ride | null>(null);
  const [message, setMessage] = useState('');
  const load = async () => {
    try {
      const r = await api<Ride>('GET', `/api/test-rides/${rideId}`);
      setRide(r);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setRide(null);
    }
  };
  useEffect(() => { void load(); }, [rideId]);
  useEffect(() => {
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [rideId]);
  if (ride === null) return <NotFoundScreen />;
  const confirm = async () => {
    try {
      await api<Ride>('POST', `/api/test-rides/${ride.id}/confirm`, {});
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.body.error === 'hold_expired') setMessage('Your hold ran out. The slot is free again.');
    }
  };
  const cancel = async () => {
    try {
      await api<Ride>('POST', `/api/test-rides/${ride.id}/cancel`, {});
      setMessage('Test ride cancelled.');
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.body.error === 'cancellation_closed') setMessage('Free cancellation has closed for this ride.');
    }
  };
  return (
    <main class="narrow">
      <h1 tabindex={-1}>Test ride confirmed</h1>
      <OutageBanner />
      <p role="status" aria-live="polite" aria-label="Ride status" tabindex={-1} class="status-line">{message}</p>
      <table class="ruled" aria-label="Ride">
        <tbody>
          <tr><th>Bike</th><td>{ride.bikeName ?? ride.bikeId}</td></tr>
          <tr><th>Date</th><td class="num">{ride.localDate}</td></tr>
          <tr><th>Time</th><td class="num">{ride.localTime}</td></tr>
          <tr><th>State</th><td>{ride.state}</td></tr>
        </tbody>
      </table>
      {ride.state === 'held' ? <button class="primary" onClick={() => { void confirm(); }}>Confirm ride</button> : null}
      {ride.state === 'confirmed' && ride.freeCancellation ? <button onClick={() => { void cancel(); }}>Cancel ride</button> : null}
    </main>
  );
}

function NotFoundScreen(): ComponentChild {
  return (
    <main class="narrow not-found">
      <h1>We couldn't find that page.</h1>
      <p><a href="/" data-route>Back to the story</a></p>
    </main>
  );
}

// ---- Desk -----------------------------------------------------------------

export function Desk(): ComponentChild {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [rides, setRides] = useState<(Ride & { riderName: string; bikeName: string })[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [message, setMessage] = useState('');
  const [times, setTimes] = useState('');
  const [bikeId, setBikeId] = useState('BK-KADE-25');
  const [bikes, setBikes] = useState<Bike[]>([]);
  const cat = useRef<Catalogue | null>(null);
  useEffect(() => {
    void api<{ bikes: Bike[] }>('GET', '/api/bikes').then((r) => setBikes(r.bikes));
    void api<Catalogue>('GET', '/api/catalogue').then((c) => { cat.current = c; });
  }, []);
  const loadDay = async () => {
    try {
      const r = await api<{ rides: (Ride & { riderName: string; bikeName: string })[] }>('GET', `/api/desk/rides?date=${date}`);
      setRides(r.rides);
      const o = await api<{ orders: Order[] }>('GET', '/api/desk/orders');
      setOrders(o.orders);
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) setMessage('Only the fitter can open the desk.');
    }
  };
  useEffect(() => { void loadDay(); }, [date]);
  useEffect(() => {
    const t = setInterval(loadDay, 3000);
    return () => clearInterval(t);
  }, [date]);
  const openSlots = async () => {
    try {
      const parsed = times.split(',').map((t) => t.trim()).filter(Boolean);
      const r = await api<{ slots: Slot[] }>('POST', '/api/desk/ride-days', { bikeId, date, times: parsed });
      setMessage(`Opened ${r.slots.length} slots.`);
      setTimes('');
    } catch (e) {
      if (e instanceof ApiError) {
        const code = e.body.error ?? '';
        if (code === 'slot_exists') setMessage('Those slots already exist.');
        else if (e.status === 422) setMessage('Enter 24-hour times as HH:MM.');
      }
    }
  };
  const outcome = async (rideId: string, out: 'ridden' | 'no-show') => {
    try {
      await api('POST', `/api/desk/rides/${rideId}/outcome`, { outcome: out });
      setMessage(out === 'ridden' ? 'Marked ridden.' : 'Marked no-show.');
      await loadDay();
    } catch (e) {
      if (e instanceof ApiError && e.body.error === 'ride_not_started') setMessage('The ride has not started yet.');
    }
  };
  const waiting = orders.filter((o) =>
    o.schedule.some((s) => s.status === 'pending') || o.refunds.some((r) => r.status === 'pending'));
  return (
    <main>
      <h1>Desk</h1>
      <OutageBanner />
      <p role="status" aria-live="polite" aria-label="Desk status" tabindex={-1} class="status-line">{message}</p>
      <section class="panel">
        <h3>Ride day</h3>
        <div class="field"><label for="desk-date">Ride date</label><input id="desk-date" aria-label="Ride date" type="date" value={date} onChange={(e) => setDate((e.target as HTMLInputElement).value)} /></div>
        <div class="field"><label for="desk-bike">Bike</label>
          <select id="desk-bike" aria-label="Bike" value={bikeId} onChange={(e) => setBikeId((e.target as HTMLSelectElement).value)}>
            {bikes.map((b) => <option value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <div class="field"><label for="desk-times">Slot times</label><input id="desk-times" aria-label="Slot times" placeholder="10:00, 13:00" value={times} onInput={(e) => setTimes((e.target as HTMLInputElement).value)} /></div>
        <button class="primary" onClick={() => { void openSlots(); }}>Open slots</button>
        {rides.length === 0 ? <p class="empty-note" role="status">No test rides on this day.</p> : (
          <table class="ruled" aria-label="Ride day">
            <thead><tr><th>Time</th><th>Rider</th><th>Bike</th><th>State</th><th></th></tr></thead>
            <tbody>
              {rides.map((r) => (
                <tr key={r.id}>
                  <td class="num">{r.localTime}</td>
                  <td>{r.riderName}</td>
                  <td>{r.bikeName}</td>
                  <td>{r.state}</td>
                  <td>
                    {r.state === 'confirmed' ? (
                      <span>
                        <button onClick={() => { void outcome(r.id, 'ridden'); }}>Mark ridden</button>
                        <button onClick={() => { void outcome(r.id, 'no-show'); }}>Mark no-show</button>
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section class="panel">
        <h3>Payments waiting</h3>
        {waiting.length === 0 ? <p class="empty-note" role="status">No payments waiting on the provider.</p> : (
          <table class="ruled" aria-label="Payments waiting">
            <thead><tr><th>Order</th><th></th></tr></thead>
            <tbody>
              {waiting.map((o) => (
                <tr key={o.id}>
                  <td class="num">{o.number}</td>
                  <td><a href={`/desk/orders/${o.id}`} data-route>{`Open order ${o.number}`}</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}

export function DeskOrder({ orderId }: { orderId: string }): ComponentChild {
  const [order, setOrder] = useState<(Order & { payments?: { stage: string; amountCents: number; status: string; killbillPaymentId: string | null }[] }) | null>(null);
  const [refundLine, setRefundLine] = useState('');
  const [refundAmount, setRefundAmount] = useState('');
  const [refundStatus, setRefundStatus] = useState('');
  const [inspectionStatus, setInspectionStatus] = useState('');
  const [deliveredOn, setDeliveredOn] = useState(() => new Date().toISOString().slice(0, 10));
  const providers = useProviders();
  const load = async () => {
    try {
      const o = await api<Order & { payments: { stage: string; amountCents: number; status: string; killbillPaymentId: string | null }[] }>('GET', `/api/desk/orders/${orderId}`);
      setOrder(o);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setOrder(null);
    }
  };
  useEffect(() => { void load(); }, [orderId]);
  useEffect(() => {
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [orderId]);
  if (order === null) return <NotFoundScreen />;
  const amountCents = Math.round(Number(refundAmount) * 100);
  const isClassMove = order.donor && order.config && order.donor.roadClass !== order.config.roadClass;
  return (
    <main class="narrow">
      <h1>Order {order.number}</h1>
      <OutageBanner />
      <p role="status" aria-live="polite" aria-label="Order state" tabindex={-1} class="order-state-word">
        {order.state}{order.partlyRefunded ? ', partly refunded' : ''}
      </p>
      <div class="two-col">
        <div>
          <table class="ruled" aria-label="Payments">
            <thead><tr><th>Stage</th><th class="num">Amount</th><th>Status</th><th>Provider</th></tr></thead>
            <tbody>
              {(order.payments ?? []).map((p) => (
                <tr key={p.stage}>
                  <td>{p.stage}</td>
                  <td class="num">{formatCents(p.amountCents)}</td>
                  <td>{p.status} <span class="status-word">{p.status}</span></td>
                  <td class="num">{p.killbillPaymentId ?? '—'}</td>
                </tr>
              ))}
              {order.refunds.flatMap((r) => r.draws.map((d, i) => (
                <tr key={`${r.id}-${i}`}>
                  <td>Refund draw {i + 1}</td>
                  <td class="num">{formatCents(d.amountCents)}</td>
                  <td>{d.status} <span class="status-word">{d.status}</span></td>
                  <td class="num">{d.killbillPaymentId ?? '—'}</td>
                </tr>
              )))}
            </tbody>
          </table>
          <table class="ruled" aria-label="Kit lines">
            <thead><tr><th>Line</th><th class="num">Collected</th></tr></thead>
            <tbody>
              {order.lines.map((l) => (
                <tr key={l.id}><td>{l.name}</td><td class="num">{formatCents(l.collectedCents)} <span class="status-word">{l.collectedCents > 0 ? 'paid' : 'scheduled'}</span></td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <section class="panel">
            <h3>Refund a line</h3>
            <div class="field">
              <label for="rf-line">Refund line</label>
              <select id="rf-line" aria-label="Refund line" value={refundLine} onChange={(e) => setRefundLine((e.target as HTMLSelectElement).value)}>
                <option value="">Pick a line</option>
                {order.lines.map((l) => <option value={l.id}>{l.name}</option>)}
              </select>
            </div>
            <div class="field">
              <label for="rf-amount">Refund amount in euros</label>
              <input id="rf-amount" aria-label="Refund amount in euros" inputMode="decimal" placeholder="12.50" value={refundAmount} onInput={(e) => setRefundAmount((e.target as HTMLInputElement).value)} />
            </div>
            <button
              aria-disabled={providers.killbill === 'down' || !refundLine}
              onClick={() => {
                if (providers.killbill === 'down' || !refundLine) return;
                if (!/^\d+(\.\d{1,2})?$/.test(refundAmount.trim())) {
                  setRefundStatus('Enter an amount like 12.50.');
                  return;
                }
                void (async () => {
                  try {
                    const r = await api<Order>('POST', `/api/desk/orders/${orderId}/refunds`,
                      { lineId: refundLine, amountCents }, `refund-${Math.random().toString(36).slice(2)}`);
                    setRefundStatus(`Refund of ${formatCents(amountCents)} sent. Pending until the provider confirms.`);
                    void r;
                  } catch (e) {
                    if (e instanceof ApiError) {
                      const code = e.body.error ?? '';
                      const errs = e.body.errors ?? {};
                      if (errs['amountCents']) setRefundStatus(errs['amountCents']);
                      else if (code === 'payment_in_flight') setRefundStatus('A payment is still pending. Try again once it settles.');
                      else if (code === 'fee_already_spent') setRefundStatus('The inspection fee has been passed on and cannot be refunded.');
                      else if (code === 'payments_paused') setRefundStatus('Payments are paused. Nothing has been charged.');
                      else setRefundStatus('Refund refused.');
                    }
                  }
                })();
              }}
            >Refund line</button>
            <p role="status" aria-live="polite" aria-label="Refund status" tabindex={-1} class="status-line">{refundStatus}</p>
          </section>
          <section class="panel">
            <h3>Fulfilment</h3>
            {order.state === 'paid in full' ? (
              <div>
                {order.kind === 'kit' && order.config?.fulfilment === 'posted'
                  ? <button onClick={() => { void api<Order>('POST', `/api/desk/orders/${orderId}/transitions`, { to: 'kit dispatched' }).then(load); }}>Mark dispatched</button>
                  : <button onClick={() => { void api<Order>('POST', `/api/desk/orders/${orderId}/transitions`, { to: 'fitted' }).then(load); }}>Mark fitted</button>}
              </div>
            ) : null}
            {order.state === 'kit dispatched' ? (
              <div>
                <div class="field"><label for="d-on">Delivered on</label><input id="d-on" aria-label="Delivered on" type="date" value={deliveredOn} onChange={(e) => setDeliveredOn((e.target as HTMLInputElement).value)} /></div>
                <button onClick={() => { void api<Order>('POST', `/api/desk/orders/${orderId}/delivered`, { deliveredOn }).then(load); }}>Mark delivered</button>
              </div>
            ) : null}
            {isClassMove && ['kit dispatched', 'fitted'].includes(order.state) ? (
              <div>
                <button onClick={() => {
                  void (async () => {
                    try {
                      await api<Order>('POST', `/api/desk/orders/${orderId}/inspection`, {});
                      setInspectionStatus('Inspection recorded. Fit the new plate before riding.');
                      await load();
                    } catch (e) {
                      if (e instanceof ApiError) {
                        const code = e.body.error ?? '';
                        if (code === 'registry_not_updated') setInspectionStatus('The registry still shows the old class. Inspection not recorded.');
                        else if (code === 'registry_unreachable') setInspectionStatus('Plate registry unreachable. Inspection not recorded.');
                      }
                    }
                  })();
                }}>Record inspection</button>
              </div>
            ) : null}
            <p role="status" aria-live="polite" aria-label="Inspection status" tabindex={-1} class="status-line">{inspectionStatus}</p>
          </section>
        </div>
      </div>
    </main>
  );
}

// ---- Auth -----------------------------------------------------------------

export function SignIn(): ComponentChild {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const submit = async (e: Event) => {
    e.preventDefault();
    try {
      const user = await api<{ id: string; role: string; landing: string; email: string; name: string; country: string }>('POST', '/api/auth/sign-in', { email, password });
      window.dispatchEvent(new CustomEvent('signed-in', { detail: user }));
      window.location.href = user.landing;
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) setError('Email or password is wrong.');
        else if (err.status === 422) setErrors(err.body.errors ?? {});
      }
    }
  };
  return (
    <main class="narrow" style="max-width:480px">
      <h1>Sign in</h1>
      <form aria-label="Sign in" onSubmit={submit}>
        <div class="field"><label for="si-email">Email</label><input id="si-email" aria-label="Email" type="email" value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} />{errors['email'] ? <p class="error-text">{errors['email']}</p> : null}</div>
        <div class="field"><label for="si-password">Password</label><input id="si-password" aria-label="Password" type="password" value={password} onInput={(e) => setPassword((e.target as HTMLInputElement).value)} />{errors['password'] ? <p class="error-text">{errors['password']}</p> : null}</div>
        {error ? <p class="alert-banner">{error}</p> : null}
        <button class="primary" type="submit">Sign in</button>
      </form>
    </main>
  );
}

export function Register(): ComponentChild {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [country, setCountry] = useState('NL');
  const [error, setError] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const submit = async (e: Event) => {
    e.preventDefault();
    try {
      const user = await api<{ landing: string }>('POST', '/api/auth/register', { email, password, name, country });
      window.location.href = user.landing;
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409) setError('An account with this email already exists.');
        else if (err.status === 422) setErrors(err.body.errors ?? {});
      }
    }
  };
  return (
    <main class="narrow" style="max-width:480px">
      <h1>Register</h1>
      <form aria-label="Register" onSubmit={submit}>
        <div class="field"><label for="rg-email">Email</label><input id="rg-email" aria-label="Email" type="email" value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} />{errors['email'] ? <p class="error-text">{errors['email']}</p> : null}</div>
        <div class="field"><label for="rg-password">Password</label><input id="rg-password" aria-label="Password" type="password" value={password} onInput={(e) => setPassword((e.target as HTMLInputElement).value)} />{errors['password'] ? <p class="error-text">{errors['password']}</p> : null}</div>
        <div class="field"><label for="rg-name">Name</label><input id="rg-name" aria-label="Name" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />{errors['name'] ? <p class="error-text">{errors['name']}</p> : null}</div>
        <div class="field"><label for="rg-country">Country</label>
          <select id="rg-country" aria-label="Country" value={country} onChange={(e) => setCountry((e.target as HTMLSelectElement).value)}>
            <option value="NL">NL</option><option value="BE">BE</option><option value="DE">DE</option><option value="LU">LU</option>
          </select>
        </div>
        {error ? <p class="alert-banner">{error}</p> : null}
        <button class="primary" type="submit">Register</button>
      </form>
    </main>
  );
}

// ---- Story ----------------------------------------------------------------

export function Story(): ComponentChild {
  const [parts, setParts] = useState<ScenePart[]>([]);
  const [progress, setProgress] = useState(0);
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const sceneRef = useRef<MopedScene | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const [renderer, setRenderer] = useState<'webgl' | 'still'>('webgl');
  useEffect(() => {
    void api<{ parts: ScenePart[] }>('GET', '/api/catalogue').then((c) => setParts(c.parts));
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  useEffect(() => {
    if (reduced || !hostRef.current || !parts.length) return;
    const scene = new MopedScene(parts, { onAttributes: () => undefined });
    sceneRef.current = scene;
    const how = scene.mount(hostRef.current);
    setRenderer(how);
    if (how === 'still') {
      const canvas = document.createElement('canvas');
      canvas.className = 'moped-still';
      hostRef.current.appendChild(canvas);
    }
    return () => { scene.dispose(); sceneRef.current = null; };
  }, [reduced, parts]);
  useEffect(() => {
    const onScroll = () => {
      const el = document.getElementById('story-scroll');
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const total = rect.height - window.innerHeight;
      const p = Math.max(0, Math.min(1, -rect.top / Math.max(1, total)));
      setProgress(p);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  const offsets = storyOffsetsFor(parts, progress);
  useEffect(() => {
    sceneRef.current?.setStoryOffsets(offsets);
    if (renderer === 'still' && hostRef.current) {
      const canvas = hostRef.current.querySelector('canvas');
      if (canvas) drawStill(canvas as HTMLCanvasElement, parts, { selectedPart: '', travelMm: {}, foulingPart: null, foulingFeature: null });
    }
  }, [offsets, renderer]);
  useEffect(() => {
    if (!reduced || !parts.length) return;
    const canvases = document.querySelectorAll<HTMLCanvasElement>('.still-frame canvas.moped-still');
    canvases.forEach((canvas) => {
      const stageNum = Number(canvas.dataset['stage'] ?? 1);
      drawStill(canvas, parts, { selectedPart: '', travelMm: {}, foulingPart: null, foulingFeature: null });
      void stageNum;
    });
  }, [reduced, parts]);
  const stage = progress >= 1 ? 6 : Math.floor(progress * 6) + 1;
  if (reduced) {
    return (
      <main>
        <h1>The teardown</h1>
        <OutageBanner />
        <div class="still-stack">
          {STORY_CAPTIONS.map((caption, i) => (
            <div class="still-frame" key={caption} data-story-stage={i + 1}
              data-story-offsets={JSON.stringify(storyOffsetsFor(parts, (i + 1) / 6))}>
              <canvas class="moped-still" aria-hidden="true" data-stage={i + 1} />
              <p class="still-caption">{caption}</p>
            </div>
          ))}
        </div>
      </main>
    );
  }
  return (
    <main>
      <div class="story-pin">
        <h1>The teardown</h1>
        <div class="title-block">
          <span class="tb-title">Ommezwaai Feeler</span>
          <span>Retrofit in millimetres</span>
        </div>
        <div
          ref={hostRef}
          role="application"
          aria-label="Moped scene"
          tabindex={0}
          data-renderer={renderer}
          data-mesh-count={renderer === 'webgl' ? (sceneRef.current?.state.meshCount ?? 0) : parts.length}
          data-azimuth-deg={sceneRef.current?.state.azimuthDeg ?? 30}
          data-elevation-deg={sceneRef.current?.state.elevationDeg ?? 15}
          data-zoom={sceneRef.current?.state.zoom ?? 1}
          data-selected-part=""
          data-story-progress={progress.toFixed(3)}
          data-story-stage={stage}
          data-story-offsets={JSON.stringify(offsets)}
        />
        <p class="story-caption">{STORY_CAPTIONS[Math.max(0, stage - 1)]}</p>
      </div>
      <div class="story-body" id="story-scroll" />
    </main>
  );
}
