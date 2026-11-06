import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Bike, Ride, RoadClass, Slot } from '../../shared/types.js';
import { ApiError, SessionEnded, get, post } from '../api.js';
import { ClassMark } from '../components/ClassMark.js';
import { Panel } from '../components/Panel.js';
import { usePoll } from '../hooks.js';
import { Link, navigate, useLocation } from '../router.js';
import { useHold, useSession } from '../session.js';
import { Money } from '../components/Money.js';
import { useCatalogue } from '../catalogue.js';
import { CheckoutDialog } from './Checkout.js';
import { NotFound } from './NotFound.js';

const FILTERS: { value: '' | '25' | '45'; text: string; mark?: RoadClass }[] = [{ value: '', text: 'All' }, { value: '25', text: '25 km/h', mark: 25 }, { value: '45', text: '45 km/h', mark: 45 }];

export function Bikes(): ReactNode {
  const { search } = useLocation();
  const filter = search.get('class') === '25' ? '25' : search.get('class') === '45' ? '45' : '';
  const [bikes, setBikes] = useState<Bike[] | null>(null);
  useEffect(() => { document.title = 'Bikes · Ommezwaai Feeler'; }, []);
  useEffect(() => {
    let alive = true;
    get<{ bikes: Bike[] }>(`/api/bikes${filter ? `?class=${filter}` : ''}`, { poll: true }).then((r) => { if (alive) setBikes(r.bikes); }, () => undefined);
    return () => { alive = false; };
  }, [filter]);
  const longest = Math.max(1, ...(bikes ?? []).map((b) => b.rangeKm));
  return (
    <section className="page">
      <h1>Built e-mopeds</h1>
      <p className="lede">Compare by road class and range, then book a test ride.</p>
      <div className="field">
        <span className="label">Road class filter</span>
        <div className="segmented" role="radiogroup" aria-label="Road class filter">
          {FILTERS.map((f) => (
            <label key={f.text} className="seg" data-checked={filter === f.value}>
              <input type="radio" name="bike-class" checked={filter === f.value} aria-label={f.text} onChange={() => navigate(f.value ? `/bikes?class=${f.value}` : '/bikes')} />
              {f.mark ? <ClassMark roadClass={f.mark} label={f.text} /> : <span>{f.text}</span>}
            </label>
          ))}
        </div>
      </div>
      <h2>Range comparison</h2>
      <div className="bike-table-wrap">
      <table className="ruled-table bike-table" role="table" aria-label="Bike comparison">
        <thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Bike</th><th role="columnheader" scope="col">Road class</th><th role="columnheader" scope="col">Range</th><th role="columnheader" scope="col">Price</th></tr></thead>
        <tbody role="rowgroup">
          {(bikes ?? []).map((b) => (
            <tr role="row" key={b.id}>
              <td role="cell" data-label="Bike"><Link to={`/bikes/${b.id}`}>{b.name}</Link></td>
              <td role="cell" data-label="Road class"><ClassMark roadClass={b.roadClass} /></td>
              <td role="cell" data-label="Range">
                <span className="range-cell"><span className="num">{b.rangeKm} km</span><span className="range-bar" aria-hidden="true"><span style={{ width: `${(b.rangeKm / longest) * 100}%` }} /></span></span>
              </td>
              <td role="cell" data-label="Price"><Money cents={b.grossCents} word="quoted" /></td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      {bikes === null ? <p className="hint">Loading...</p> : null}
      <h3>Notes to this sheet</h3>
      <div className="sheet-notes">
        <section>
          <h4>Road classes</h4>
          <h5><ClassMark roadClass={25} /></h5>
          <p>Snorfiets in the Netherlands, class A in Belgium, Mofa in Germany.</p>
          <h5><ClassMark roadClass={45} /></h5>
          <p>Bromfiets in the Netherlands, class B in Belgium, Kleinkraftrad in Germany.</p>
        </section>
        <section>
          <h4>Range and price</h4>
          <p>The table holds the longest range first. Prices are quoted gross, and the bike handover line is added at checkout.</p>
        </section>
      </div>
    </section>
  );
}

const HOLD_MESSAGES: Record<string, string> = {
  slot_gone: 'That slot has just gone. Pick another.',
  hold_exists: 'You already hold a slot. Confirm it or let it run out.',
  same_day_closed: 'Same-day booking closed at 12:00.',
  hold_expired: 'Your hold ran out. The slot is free again.',
};

export function BikePage({ id }: { id: string }): ReactNode {
  const { user, today, providers } = useSession();
  const hold = useHold();
  const [bike, setBike] = useState<Bike | null | undefined>(undefined);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const checkoutButton = useRef<HTMLButtonElement>(null);
  const catalogue = useCatalogue();
  const handover = catalogue?.fixedLines.find((l) => l.code === 'HANDOVER')?.grossCents ?? 0;

  useEffect(() => {
    get<{ bikes: Bike[] }>('/api/bikes', { poll: true }).then((r) => setBike(r.bikes.find((b) => b.id === id) ?? null), () => setBike(null));
  }, [id]);
  useEffect(() => { document.title = `${bike?.name ?? 'Bike'} · Ommezwaai Feeler`; }, [bike]);
  usePoll(async () => {
    const r = await get<{ slots: Slot[] }>(`/api/bikes/${id}/slots`, { poll: true });
    setSlots((was) => (JSON.stringify(was) === JSON.stringify(r.slots) ? was : r.slots));
  }, 3000, [id]);

  if (bike === null) return <NotFound />;
  if (!bike || !slots) return <section className="page"><p className="hint">Loading...</p></section>;

  const press = async (slot: Slot): Promise<void> => {
    if (!user) {
      navigate('/sign-in');
      return;
    }
    try {
      await post<Ride>('/api/test-rides/holds', { slotId: slot.id });
      await hold.reload();
    } catch (caught) {
      if (caught instanceof SessionEnded) return;
      if (caught instanceof ApiError) hold.announce(HOLD_MESSAGES[caught.code] ?? 'The slot could not be held.');
      void get<{ slots: Slot[] }>(`/api/bikes/${id}/slots`, { poll: true }).then((r) => setSlots(r.slots), () => undefined);
    }
  };
  const confirmHold = async (): Promise<void> => {
    if (!hold.ride) return;
    try {
      const ride = await post<Ride>(`/api/test-rides/${hold.ride.id}/confirm`);
      await hold.reload();
      navigate(`/rides/${ride.id}`);
    } catch (caught) {
      if (caught instanceof SessionEnded) return;
      if (caught instanceof ApiError) hold.announce(HOLD_MESSAGES[caught.code] ?? 'The ride could not be confirmed.');
      await hold.reload();
    }
  };

  const upcoming = slots.filter((s) => !today || s.localDate >= today);
  const ownHold = hold.ride && hold.ride.bikeId === id ? hold.ride : null;
  return (
    <section className="page bike-page">
      <div className="bike-main">
        <p className="crumb"><Link to="/bikes">Bikes</Link></p>
        <h1>{bike.name}</h1>
        <dl className="spec-list">
          <div><dt>Road class</dt><dd><ClassMark roadClass={bike.roadClass} /></dd></div>
          <div><dt>Range</dt><dd className="num">{bike.rangeKm} km</dd></div>
          <div><dt>Price</dt><dd><Money cents={bike.grossCents} word="quoted" /></dd></div>
        </dl>
        <h2>Test-ride slots</h2>
        {upcoming.length === 0 ? <p className="hint">No slots are open for this bike yet.</p> : null}
        <div className="slots-wrap">
        <ul className="slots" aria-label="Slots">
          {upcoming.map((slot) => (
            <li key={slot.id} data-status={slot.status}>
              {slot.status === 'free'
                ? <button type="button" className="btn slot-button" onClick={() => { void press(slot); }}>Hold {slot.localDate} {slot.localTime}</button>
                : <span className="slot-taken num">{slot.localDate} {slot.localTime} · {slot.status}</span>}
            </li>
          ))}
        </ul>
        </div>
      </div>
      <aside className="bike-side ruled" aria-label="Your hold and deposit">
        <h2>Your hold</h2>
        {ownHold ? (
          <>
            <p className="num">{ownHold.localDate} {ownHold.localTime}</p>
            <button type="button" className="btn primary" onClick={() => { void confirmHold(); }}>Confirm ride</button>
          </>
        ) : <p className="hint">Hold a slot, then confirm it while the timer runs.</p>}
        <h2>Deposit</h2>
        <p>Leave the full price as a deposit plan: a deposit of 20 percent, then three monthly instalments.</p>
        <button type="button" ref={checkoutButton} className="btn" onClick={() => (user ? setCheckoutOpen(true) : navigate('/sign-in'))}>Start checkout</button>
      </aside>
      <Panel open={checkoutOpen} name="Checkout" variant="modal" onClose={() => setCheckoutOpen(false)} opener={() => checkoutButton.current}>
        <CheckoutDialog
          schedule={null} totalCents={bike.grossCents + handover} vatCents={null} notices={[]} user={user} gateReason="" blocked={providers.killbill === 'down'}
          createBody={(plan) => ({ kind: 'bike', bikeId: bike.id, plan, expectedTotalCents: bike.grossCents + handover })}
          onDone={(orderId) => { setCheckoutOpen(false); navigate(`/orders/${orderId}`); }}
        />
      </Panel>
    </section>
  );
}
