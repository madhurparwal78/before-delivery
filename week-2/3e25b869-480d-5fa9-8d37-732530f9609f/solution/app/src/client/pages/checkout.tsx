// Checkout and the order-placed page.
import { useEffect, useRef, useState } from 'preact/hooks';
import { dropScent, pick } from '../../shared/catalog.js';
import { dropTotals, formatMoney } from '../../shared/money.js';
import { longDate } from '../../shared/toronto.js';
import { type Account, type Cart, type Hold, type Order } from '../types';
import { api, newKey } from '../api';
import { cartMessage, timeLeft } from '../cart';
import { EmailStep } from '../email-step';
import { reducedMotion, serviceStatus, useCopy, useStore } from '../state';
import { ADDRESS_ORDER, type Address, AddressFields, EmptyState, ErrorSummary, type FieldError, Live, orderedErrors, PriceRows, ProvinceSelect } from '../ui';

interface Row {
  hold: Hold;
  scent: string;
  leaving: boolean;
}

function HoldRow({ row, now, onRelease, releaseRef }: { row: Row; now: number; onRelease: () => void; releaseRef: (el: HTMLButtonElement | null) => void }) {
  const { m, l } = useCopy();
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (!reducedMotion.get()) {
      ref.current?.animate([{ transform: 'translateX(32px)', opacity: 0 }, { transform: 'none', opacity: 1 }], {
        duration: 600,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      });
    }
  }, []);
  const { hold } = row;
  const scent = pick(dropScent(row.scent)?.name ?? { en: row.scent, fr: row.scent }, l);
  return (
    <li class={`hold-row${row.leaving ? ' is-leaving' : ''}`} ref={ref} data-hold={hold.id}>
      <span class="hold-label">{m.heldRow(hold.bar, scent, hold.batch)}</span>
      {!row.leaving && (
        <>
          <span role="timer" aria-label={m.timer(hold.bar)} class="num timer">
            {timeLeft(Date.parse(hold.expires_at) - now)}
          </span>
          <button type="button" class="button secondary small" ref={releaseRef} onClick={onRelease}>
            {m.release(hold.bar)}
          </button>
        </>
      )}
    </li>
  );
}

export function CheckoutPage() {
  const { m, l } = useCopy();
  const status = useStore(serviceStatus);
  const [cart, setCart] = useState<Cart | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [scents, setScents] = useState<Record<string, string>>({});
  const [province, setProvince] = useState('QC');
  const [signedIn, setSignedIn] = useState<string | null>(null);
  const [accountKnown, setAccountKnown] = useState(false);
  const [address, setAddress] = useState<Address>({ name: '', line1: '', city: '', postal_code: '' });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [paying, setPaying] = useState(false);
  const [message, setMessage] = useState('');
  const [offset, setOffset] = useState(0);
  const [tick, setTick] = useState(Date.now());
  const nameRef = useRef<HTMLInputElement>(null);
  const backRef = useRef<HTMLAnchorElement>(null);
  const releaseRefs = useRef(new Map<string, HTMLButtonElement>());
  const key = useRef(newKey());
  const known = useRef(new Set<string>());
  const minuteSaid = useRef(new Set<string>());
  const ended = useRef(new Set<string>());
  const state = useRef({ rows, province, l, m });
  state.current = { rows, province, l, m };

  const now = tick + offset;
  const active = rows.filter((r) => !r.leaving);
  const totalFor = (count: number) => dropTotals(count, state.current.province).total.cents;

  /** Removes rows (fold-away) and announces their event messages plus the new total. */
  const endRows = (ids: string[], message: (bar: number) => string) => {
    const current = state.current.rows.filter((r) => !r.leaving);
    const leaving = current.filter((r) => ids.includes(r.hold.id)).sort((a, b) => a.hold.bar - b.hold.bar);
    if (!leaving.length) return;
    leaving.forEach((r) => ended.current.add(r.hold.id));
    const before = totalFor(current.length);
    const after = totalFor(current.length - leaving.length);
    setMessage(cartMessage(state.current.m, state.current.l, leaving.map((r) => message(r.hold.bar)), before, after));
    const remove = () => setRows((rs) => rs.filter((r) => !ids.includes(r.hold.id)));
    if (reducedMotion.get()) remove();
    else setRows((rs) => rs.map((r) => (ids.includes(r.hold.id) ? { ...r, leaving: true } : r)));
    if (!reducedMotion.get()) {
      for (const id of ids) {
        const el = document.querySelector<HTMLElement>(`[data-hold="${id}"]`);
        const animation = el?.animate([{ opacity: 1, maxHeight: '64px' }, { opacity: 0, maxHeight: '0px' }], { duration: 600, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' });
        if (animation) animation.onfinish = remove;
        else remove();
      }
    }
  };

  const load = async (code = state.current.province) => {
    // The scent names arrive with the cart, so a row never changes its text (and height) after it shows.
    const [r, drop] = await Promise.all([
      api<Cart>('GET', `/api/cart?province=${code}`),
      api<{ batches: { code: string; scent: string }[] }>('GET', '/api/drop'),
    ]);
    if (drop.ok) setScents(Object.fromEntries(drop.data.batches.map((b) => [b.code, b.scent])));
    if (!r.ok) return;
    setOffset(Date.parse(r.data.server_now) - Date.now());
    setTick(Date.now());
    setCart(r.data);
    const ids = new Set(r.data.holds.map((h) => h.id));
    const gone = state.current.rows.filter((row) => !row.leaving && !ids.has(row.hold.id)).map((row) => row.hold.id);
    if (gone.length) endRows(gone, state.current.m.cartEnded);
    const fresh = r.data.holds.filter((h) => !known.current.has(h.id) && !ended.current.has(h.id));
    fresh.forEach((h) => known.current.add(h.id));
    if (fresh.length) setRows((rs) => [...rs, ...fresh.map((hold) => ({ hold, scent: '', leaving: false }))]);
  };

  useEffect(() => {
    void load();
    void api<Account>('GET', '/api/account').then((r) => {
      if (r.ok) setSignedIn(r.data.customer.email);
      setAccountKnown(true);
    });
    const poll = setInterval(() => void load(), 5000);
    const clock = setInterval(() => setTick(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(clock);
    };
  }, []);

  useEffect(() => {
    for (const row of active) {
      const left = Date.parse(row.hold.expires_at) - now;
      const life = Date.parse(row.hold.expires_at) - Date.parse(row.hold.created_at);
      if (left <= 0) {
        endRows([row.hold.id], m.cartEnded);
        void load();
        return;
      }
      if (left <= 60_000 && life > 60_000 && !minuteSaid.current.has(row.hold.id)) {
        minuteSaid.current.add(row.hold.id);
        setMessage(m.cartMinute(row.hold.bar));
      }
    }
  }, [tick, offset, rows]);

  const release = async (row: Row) => {
    const index = active.indexOf(row);
    const r = await api<{ hold: Hold }>('DELETE', `/api/holds/${row.hold.id}`);
    if (!r.ok) {
      if (r.status === 0) setMessage(m.network);
      else void load();
      return;
    }
    endRows([row.hold.id], m.cartReleased);
    const rest = active.filter((x) => x !== row);
    const target = rest[index] ?? rest[index - 1];
    queueMicrotask(() => (target ? releaseRefs.current.get(target.hold.id)?.focus() : backRef.current?.focus()));
  };

  const changeProvince = async (code: string) => {
    const before = totalFor(active.length);
    setProvince(code);
    state.current.province = code;
    const after = totalFor(active.length);
    if (before !== after) setMessage(cartMessage(m, l, [], before, after));
    await load(code);
  };

  const pay = async () => {
    if (paying || payState !== 'ready') return;
    setPaying(true);
    const before = totalFor(active.length);
    const r = await api<{ order: Order }>(
      'POST',
      '/api/checkout',
      { holds: active.map((x) => x.hold.id), shipping: { ...address, province } },
      { 'Idempotency-Key': key.current },
    );
    if (r.ok) {
      location.assign(`/checkout/placed/${r.data.order.number}`);
      return;
    }
    setPaying(false);
    if (r.status === 0) {
      setMessage(m.network);
      return;
    }
    key.current = newKey();
    if (r.status === 422 && r.error.fields) {
      setFields(r.error.fields);
      setErrors(orderedErrors(r.error.fields, [['holds', 'held-bars'], ...ADDRESS_ORDER]));
      setAttempt((a) => a + 1);
    } else if (r.status === 410) {
      const fresh = await api<Cart>('GET', `/api/cart?province=${province}`);
      const keep = new Set(fresh.ok ? fresh.data.holds.map((h) => h.id) : []);
      const gone = active.filter((x) => !keep.has(x.hold.id)).map((x) => x.hold.id);
      gone.forEach((id) => ended.current.add(id));
      setRows((rs) => rs.filter((x) => !gone.includes(x.hold.id)));
      setMessage(cartMessage(m, l, [m.hold_expired], before, totalFor(active.length - gone.length)));
      void load();
    } else {
      if (r.status === 503) serviceStatus.set({ ...serviceStatus.get(), billing: 'down' });
      setMessage(r.error.message);
      void load();
    }
  };

  const payState = paying ? 'paying' : status.billing === 'down' ? 'paused' : active.length === 0 ? 'empty' : !signedIn ? 'verify' : 'ready';
  const totals = dropTotals(active.length, province);
  const payLabel = {
    paying: m.paying,
    paused: m.checkoutPaused,
    empty: m.noBarsHeld,
    verify: m.verifyFirst,
    ready: m.pay(formatMoney(totals.total.cents, l)),
  }[payState];

  // The held bars and the email step both change height once loaded: show the page when both are known.
  if (cart === null || !accountKnown) return <p class="page loading">{m.loading}</p>;
  return (
    <div class="page columns">
      <div class="col-main">
        <h1 tabIndex={-1}>{m.checkout}</h1>
        <ErrorSummary errors={errors} attempt={attempt} />
        <section aria-label={m.heldBars} class="ruled held-bars" id="held-bars" tabIndex={-1}>
          <h2>{m.heldBars}</h2>
          {rows.length === 0 ? (
            <EmptyState>{m.noHolds}</EmptyState>
          ) : (
            <ul class="hold-rows">
              {rows.map((row) => (
                <HoldRow
                  key={row.hold.id}
                  row={{ ...row, scent: scents[row.hold.batch] ?? '' }}
                  now={now}
                  onRelease={() => void release(row)}
                  releaseRef={(el) => {
                    if (el) releaseRefs.current.set(row.hold.id, el);
                    else releaseRefs.current.delete(row.hold.id);
                  }}
                />
              ))}
            </ul>
          )}
          <Live name={m.cartUpdates} text={message} class="result-line" />
          <p>
            <a href="/" ref={backRef} class="text-link">
              {m.backToDrop}
            </a>
          </p>
        </section>
        <div class="ruled">
          <ProvinceSelect value={province} onChange={(code) => void changeProvince(code)} error={fields['shipping.province']} />
        </div>
        <div class="ruled narrow-only">
          <OrderTotal province={province} count={active.length} />
        </div>
        <div class="ruled">
          <EmailStep
            purpose="checkout"
            signedInAs={signedIn}
            announce={setMessage}
            onVerified={(email) => {
              setSignedIn(email);
              queueMicrotask(() => nameRef.current?.focus());
            }}
          />
        </div>
        <div class="ruled">
          <AddressFields value={address} onChange={setAddress} errors={fields} nameRef={nameRef} />
        </div>
        <div class="actions">
          <button
            type="button"
            class="button primary wide-button"
            aria-disabled={payState === 'ready' ? undefined : 'true'}
            aria-busy={paying ? 'true' : undefined}
            onClick={() => void pay()}
          >
            {payLabel}
          </button>
        </div>
      </div>
      <aside class="col-side wide-only">
        <div class="sticky-panel">
          <OrderTotal province={province} count={active.length} />
        </div>
      </aside>
    </div>
  );
}

function OrderTotal({ province, count }: { province: string; count: number }) {
  const { m } = useCopy();
  const totals = dropTotals(count, province);
  return (
    <section aria-label={m.orderTotal} class="order-total">
      <h2>{m.orderTotal}</h2>
      <PriceRows rows={[[m.subtotal, totals.subtotal], [m.shipping, totals.shipping_fee]]} taxes={totals.taxes} total={[m.total, totals.total]} />
    </section>
  );
}

export function PlacedPage({ number }: { number: string }) {
  const { m, l } = useCopy();
  const [order, setOrder] = useState<Order | null>(null);
  useEffect(() => {
    void api<Order>('GET', `/api/account/orders/${encodeURIComponent(number)}`).then((r) => r.ok && setOrder(r.data));
  }, [number]);
  return (
    <div class="page narrow">
      <h1 tabIndex={-1}>{m.placed(number)}</h1>
      {order && (
        <>
          <p class="lede">{m.confirmationTo(order.email)}</p>
          <OrderSummary order={order} />
          <p>
            {m.shipsOn}: <span class="num">{longDate(order.ship_on, l)}</span>
          </p>
        </>
      )}
    </div>
  );
}

export function OrderSummary({ order }: { order: Order }) {
  const { m, l } = useCopy();
  return (
    <div class="ruled">
      <ul class="order-lines">
        {order.lines.map((line) => (
          <li key={`${line.batch}-${line.bar}`}>
            <span>{m.heldRow(line.bar, pick(dropScent(line.scent)?.name ?? { en: line.scent, fr: line.scent }, l), line.batch)}</span>
            <span class="num">
              {formatMoney(line.unit_price.cents, l)}
              {line.refunded ? ` · ${m.refundedWord}` : ''}
            </span>
          </li>
        ))}
      </ul>
      <PriceRows rows={[[m.subtotal, order.subtotal], [m.shipping, order.shipping_fee]]} taxes={order.taxes} total={[m.total, order.total]} />
    </div>
  );
}
