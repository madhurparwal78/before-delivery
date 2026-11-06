import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChild } from 'preact';
import { api, ApiError, formatCents } from './api';
import type { Quote, Order, User } from './types';
import type { ConfigState } from './configurator';

// Dialog behaviour: focus is held inside, Escape closes, and focus returns to
// the opener. From the first moment of closing, nothing inside is focusable.
export function useDialog(open: boolean, onClose: () => void, openerRef: { current: HTMLElement | null }): { current: HTMLDialogElement | null } {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!open) return;
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();
    const focusables = () => Array.from(dialog.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href]'));
    const first = focusables()[0];
    first?.focus();
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        return;
      }
      if (e.key === 'Tab') {
        const list = focusables().filter((el) => el.offsetParent !== null);
        if (list.length === 0) return;
        const firstEl = list[0]!;
        const lastEl = list[list.length - 1]!;
        if (e.shiftKey && document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };
    let closing = false;
    const close = () => {
      if (closing) return;
      closing = true;
      for (const el of dialog.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href]')) {
        el.inert = true;
      }
      dialog.classList.add('closing');
      const done = () => {
        dialog.close();
        openerRef.current?.focus();
        onClose();
      };
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        done();
      } else {
        setTimeout(done, 320);
      }
    };
    dialog.addEventListener('keydown', onKeydown);
    (dialog as unknown as { _close: () => void })._close = close;
    return () => {
      dialog.removeEventListener('keydown', onKeydown);
      dialog.close();
    };
  }, [open]);
  return ref;
}

export function CheckoutDialog({ quote, config, user, onClose, onStatus, killbillUp }: {
  quote: Quote;
  config: ConfigState;
  user: User | null;
  onClose: () => void;
  onStatus: (msg: string) => void;
  killbillUp: boolean;
}): ComponentChild {
  const openerRef = useRef<HTMLElement | null>(null);
  const dialogRef = useDialog(true, onClose, openerRef);
  const [step, setStep] = useState<'Delivery' | 'Schedule' | 'Deposit'>('Delivery');
  const [plan, setPlan] = useState({ name: user?.name ?? '', street: '', postcode: '', city: '', note: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [orderId, setOrderId] = useState<string | null>(null);
  const keyRef = useRef(`checkout-${Math.random().toString(36).slice(2)}`);

  const validateDelivery = (): boolean => {
    const errs: Record<string, string> = {};
    if (!plan.name.trim()) errs['name'] = 'Required.';
    if (!plan.street.trim()) errs['street'] = 'Required.';
    if (!plan.postcode.trim()) errs['postcode'] = 'Required.';
    if (!plan.city.trim()) errs['city'] = 'Required.';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const payDeposit = async () => {
    setBusy(true);
    onStatus('Payment sent. Waiting for confirmation.');
    try {
      if (!orderId) {
        const order = await api<Order>('POST', '/api/orders', {
          kind: 'kit',
          config: {
            donor: 'plate' in (config.donor ?? {}) ? config.donor : config.donor,
            packId: config.packId,
            hubId: config.hubId,
            roadClass: config.roadClass,
            fulfilment: config.fulfilment,
            country: config.country,
          },
          plan: { name: plan.name, street: plan.street, postcode: plan.postcode, city: plan.city, note: plan.note || undefined },
          expectedTotalCents: quote.totalCents,
        });
        setOrderId(order.id);
        await api<Order>('POST', `/api/orders/${order.id}/payments`, { stage: 'deposit' }, keyRef.current);
      } else {
        await api<Order>('POST', `/api/orders/${orderId}/payments`, { stage: 'deposit' }, keyRef.current);
      }
      window.location.href = `/orders/${orderId ?? ''}`;
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 401) {
          window.dispatchEvent(new CustomEvent('sign-again'));
          return;
        }
        const code = e.body.error ?? '';
        const messages: Record<string, string> = {
          'quote_changed': 'The inspection fee changed. Check the new total before paying.',
          'payments_paused': 'Payments are paused. Nothing has been charged.',
          'payment_refused': 'Deposit failed. Nothing was taken.',
          'fit_not_passed': 'Fit not proven. No deposit can be taken.',
          'donor_unconfirmed': 'Donor unconfirmed. No deposit can be taken.',
          'donor_changed': "This scooter's registration changed. Prove the fit again.",
          'registry_unreachable': 'Plate registry unreachable. Your fit stays unconfirmed until it answers.',
          'payment_in_flight': 'A payment is still pending. Try again once it settles.',
          'stage_out_of_order': 'Instalment 1 paid.',
          'stage_already_paid': 'Deposit paid.',
        };
        onStatus(messages[code] ?? code);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog ref={dialogRef} aria-label="Checkout">
      <h2>Checkout — {step}</h2>
      {step === 'Delivery' ? (
        <div>
          <div class="field">
            <label for="ck-name">Name</label>
            <input id="ck-name" aria-label="Name" value={plan.name} onInput={(e) => setPlan({ ...plan, name: (e.target as HTMLInputElement).value })} />
            {errors['name'] ? <p class="error-text">{errors['name']}</p> : null}
          </div>
          <div class="field">
            <label for="ck-street">Street</label>
            <input id="ck-street" aria-label="Street" value={plan.street} onInput={(e) => setPlan({ ...plan, street: (e.target as HTMLInputElement).value })} />
            {errors['street'] ? <p class="error-text">{errors['street']}</p> : null}
          </div>
          <div class="field">
            <label for="ck-postcode">Postcode</label>
            <input id="ck-postcode" aria-label="Postcode" value={plan.postcode} onInput={(e) => setPlan({ ...plan, postcode: (e.target as HTMLInputElement).value })} />
            {errors['postcode'] ? <p class="error-text">{errors['postcode']}</p> : null}
          </div>
          <div class="field">
            <label for="ck-city">City</label>
            <input id="ck-city" aria-label="City" value={plan.city} onInput={(e) => setPlan({ ...plan, city: (e.target as HTMLInputElement).value })} />
            {errors['city'] ? <p class="error-text">{errors['city']}</p> : null}
          </div>
        </div>
      ) : null}
      {step === 'Schedule' ? (
        <div>
          <table class="ruled" aria-label="Payment schedule">
            <thead><tr><th>Stage</th><th class="num">Amount</th></tr></thead>
            <tbody>
              {quote.schedule.map((stage) => (
                <tr key={stage.stage}>
                  <td>{stage.label}</td>
                  <td class="num">{formatCents(stage.amountCents)} <span class="status-word">scheduled</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>Total {formatCents(quote.totalCents)} <span class="status-word">quoted</span></p>
        </div>
      ) : null}
      {step === 'Deposit' ? (
        <div>
          <p>Pay the deposit of {formatCents(quote.schedule[0].amountCents)} <span class="status-word">quoted</span>.</p>
          <p style="font-size:0.85rem">{quote.notices[0]}</p>
        </div>
      ) : null}
      <div class="dialog-actions">
        {step !== 'Delivery' ? <button onClick={() => setStep(step === 'Deposit' ? 'Schedule' : 'Delivery')}>Back</button> : <span />}
        {step !== 'Deposit' ? (
          <button class="primary" onClick={() => {
            if (step === 'Delivery' && !validateDelivery()) return;
            setStep(step === 'Delivery' ? 'Schedule' : 'Deposit');
          }}>Next</button>
        ) : (
          <button
            class="primary"
            aria-disabled={busy || !killbillUp}
            onClick={() => {
              if (busy || !killbillUp) return;
              void payDeposit();
            }}
          >Pay deposit</button>
        )}
      </div>
    </dialog>
  );
}

// ---- Order pages ---------------------------------------------------------------

export function OrdersList(): ComponentChild {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const refresh = async () => {
    try {
      const res = await api<{ orders: Order[] }>('GET', '/api/orders');
      setOrders(res.orders);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return;
    }
  };
  useEffect(() => { void refresh(); }, []);
  const resume = sessionStorage.getItem('resume-config');
  return (
    <main class="narrow">
      <h1>My orders</h1>
      <OutageBannerInline />
      {resume ? <p><a href={resume} data-route>Resume your configuration</a></p> : null}
      {orders === null ? <p role="status">Loading…</p> : orders.length === 0 ? (
        <p class="empty-note" role="status">No orders yet. Prove a fit first.</p>
      ) : (
        <table class="ruled" aria-label="Orders">
          <thead><tr><th>Number</th><th>State</th><th class="num">Total</th><th></th></tr></thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id}>
                <td class="num">{o.number}</td>
                <td>{o.state}{o.partlyRefunded ? ', partly refunded' : ''}</td>
                <td class="num">{formatCents(o.totalCents)} <span class="status-word">{o.state === 'quoted' ? 'quoted' : 'paid'}</span></td>
                <td><a href={`/orders/${o.id}`} data-route>{`Open order ${o.number}`}</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}

import { OutageBanner, useProviders } from './shared';

function OutageBannerInline(): ComponentChild {
  return <OutageBanner />;
}

export function OrderPage({ orderId }: { orderId: string }): ComponentChild {
  const [order, setOrder] = useState<Order | null>(null);
  const [paymentStatus, setPaymentStatus] = useState('');
  const [planOpen, setPlanOpen] = useState(false);
  const [planStatus, setPlanStatus] = useState('');
  const providers = useProviders();
  const load = async () => {
    try {
      const o = await api<Order>('GET', `/api/orders/${orderId}`);
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

  if (order === null) {
    return <NotFound />;
  }
  const payable = order.schedule.find((s) => s.status === 'scheduled' || s.status === 'failed' || s.status === 'overdue');
  const nextStage = payable;
  const stageKeyMap = useRef(new Map<string, string>());

  const payStage = async (stage: string) => {
    setPaymentStatus('Payment sent. Waiting for confirmation.');
    try {
      await api<Order>('POST', `/api/orders/${orderId}/payments`, { stage }, stageKeyMap.current.get(stage) ?? (() => {
        const k = `pay-${stage}-${Math.random().toString(36).slice(2)}`;
        stageKeyMap.current.set(stage, k);
        return k;
      })());
      await load();
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 401) { window.dispatchEvent(new CustomEvent('sign-again')); return; }
        const code = e.body.error ?? '';
        const messages: Record<string, string> = {
          'payment_in_flight': 'Payment sent. Waiting for confirmation.',
          'stage_already_paid': `${stage === 'deposit' ? 'Deposit' : stage.replace('instalment-', 'Instalment ')} paid.`,
          'payments_paused': 'Payments are paused. Nothing has been charged.',
          'refund_in_flight': 'A refund is still pending. Try again once it settles.',
          'stage_out_of_order': 'Instalment 1 paid.',
          'illegal_transition': 'Order in arrears. The kit will not be dispatched until this clears.',
        };
        setPaymentStatus(messages[code] ?? code);
        if (code === 'payment_refused') setPaymentStatus(`${stage === 'deposit' ? 'Deposit' : stage.replace('instalment-', 'Instalment ')} failed. Nothing was taken.`);
      }
    }
    await load();
  };

  return (
    <main class="narrow">
      <h1>Order {order.number}</h1>
      <OutageBannerInline />
      <p role="status" aria-live="polite" aria-label="Order state" tabindex={-1} class="order-state-word">
        {order.state}{order.partlyRefunded ? ', partly refunded' : ''}
      </p>
      <div class="two-col">
        <div>
          <table class="ruled" aria-label="Kit lines">
            <thead><tr><th>Line</th><th class="num">Gross</th><th class="num">VAT</th><th class="num">Collected</th></tr></thead>
            <tbody>
              {order.lines.map((l) => (
                <tr key={l.id}>
                  <td>{l.name}</td>
                  <td class="num">{formatCents(l.grossCents)}</td>
                  <td class="num">{formatCents(l.vatCents)}</td>
                  <td class="num">{formatCents(l.collectedCents)} <span class="status-word">{l.collectedCents > 0 ? 'paid' : 'scheduled'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          <table class="ruled" aria-label="Payment schedule">
            <thead><tr><th>Stage</th><th>Status</th><th class="num">Amount</th><th class="num">VAT</th></tr></thead>
            <tbody>
              {order.schedule.map((s) => (
                <tr key={s.stage}>
                  <td>{s.label}</td>
                  <td>{s.status} <span class="status-word">{s.status}</span></td>
                  <td class="num">{formatCents(s.amountCents)}</td>
                  <td class="num">{formatCents(s.vatCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table class="ruled" aria-label="Allocation">
            <thead><tr><th>Stage</th><th>Line</th><th class="num">Gross</th><th class="num">VAT</th></tr></thead>
            <tbody>
              {order.schedule.flatMap((s) => s.allocations.map((a, i) => (
                <tr key={`${s.stage}-${a.lineId}-${i}`}>
                  <td>{s.label}</td>
                  <td>{order.lines.find((l) => l.id === a.lineId)?.name ?? a.lineId}</td>
                  <td class="num">{formatCents(a.grossCents)}</td>
                  <td class="num">{formatCents(a.vatCents)}</td>
                </tr>
              )))}
            </tbody>
          </table>
        </div>
        <div>
          <p role="status" aria-live="polite" aria-label="Payment status" tabindex={-1} class="status-line">{paymentStatus}</p>
          {order.state === 'in arrears' ? <p class="alert-banner">Order in arrears. The kit will not be dispatched until this clears.</p> : null}
          {nextStage && !['paid in full', 'kit dispatched', 'fitted', 'inspection passed', 'withdrawn', 'deposit pending'].includes(order.state) ? (
            <p><button class="primary" aria-disabled={providers.killbill === 'down'} onClick={() => {
              if (providers.killbill === 'down') { setPaymentStatus('Payments are paused. Nothing has been charged.'); return; }
              void payStage(nextStage.stage);
            }}>{`Pay ${nextStage.label}`}</button></p>
          ) : null}
          {order.withdrawalOpen && order.state !== 'withdrawn' ? (
            <p><button aria-disabled={providers.killbill === 'down'} onClick={() => { void withdraw(); }}>Withdraw</button></p>
          ) : null}
          {order.kind === 'kit' && order.config?.fulfilment === 'posted' && ['deposit confirmed', 'instalments running'].includes(order.state) ? (
            <p><button onClick={() => { void switchFitting(); }}>Switch to workshop fitting</button></p>
          ) : null}
          <PlanPanel order={order} open={planOpen} onToggle={() => setPlanOpen(!planOpen)} onStatus={setPlanStatus} status={planStatus} />
          <ul class="notice-list">{order.notices.map((n) => <li key={n}>{n}</li>)}</ul>
          {order.refunds.length > 0 ? (
            <table class="ruled" aria-label="Refunds">
              <thead><tr><th>Refund</th><th class="num">Amount</th><th>Status</th></tr></thead>
              <tbody>
                {order.refunds.map((r) => (
                  <tr key={r.id}>
                    <td>{order.lines.find((l) => l.id === r.lineId)?.name}</td>
                    <td class="num">{formatCents(r.amountCents)}</td>
                    <td>{r.status} <span class="status-word">{r.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      </div>
    </main>
  );

  async function withdraw() {
    try {
      await api<Order>('POST', `/api/orders/${orderId}/withdraw`, {}, `withdraw-${Math.random().toString(36).slice(2)}`);
      setPaymentStatus('Order withdrawn.');
      await load();
    } catch (e) {
      if (e instanceof ApiError) {
        const code = e.body.error ?? '';
        if (code === 'withdrawal_closed') setPaymentStatus('The withdrawal period has ended.');
        else if (code === 'payment_in_flight') setPaymentStatus('A payment is still pending. Try again once it settles.');
        else if (code === 'payments_paused') setPaymentStatus('Payments are paused. Nothing has been charged.');
        else setPaymentStatus('Order withdrawn.');
      }
    }
    await load();
  }

  async function switchFitting() {
    try {
      const updated = await api<Order>('POST', `/api/orders/${orderId}/switch-to-workshop`, {}, `switch-${Math.random().toString(36).slice(2)}`);
      const corrections = updated.schedule.reduce((sum, s) => sum + s.vatCorrectedCents, 0);
      setPaymentStatus(`Fulfilment changed to workshop fitting. VAT on paid stages corrected by ${formatCents(corrections)}.`);
      await load();
    } catch (e) {
      if (e instanceof ApiError) {
        const code = e.body.error ?? '';
        if (code === 'payment_in_flight') setPaymentStatus('A payment is still pending. Try again once it settles.');
      }
    }
  }
}

function PlanPanel({ order, open, onToggle, onStatus, status }: { order: Order; open: boolean; onToggle: () => void; onStatus: (s: string) => void; status: string }): ComponentChild {
  const [plan, setPlan] = useState({ ...order.plan });
  const [version, setVersion] = useState(order.planVersion);
  useEffect(() => { setVersion(order.planVersion); }, [order.planVersion]);
  const save = async () => {
    try {
      const updated = await api<Order>('PATCH', `/api/orders/${order.id}`, { planVersion: version, plan });
      onStatus('Plan saved.');
      setVersion(updated.planVersion);
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 412) onStatus('This plan changed elsewhere. Your entries are kept; reload to see the latest.');
        else if (e.status === 401) window.dispatchEvent(new CustomEvent('sign-again'));
      }
    }
  };
  return (
    <div class="panel" role="region" aria-label="Payment plan">
      <button aria-expanded={open} onClick={onToggle}>Payment plan</button>
      {open ? (
        <div>
          <div class="field"><label for="pl-name">Name</label><input id="pl-name" aria-label="Name" value={plan.name ?? ''} onInput={(e) => setPlan({ ...plan, name: (e.target as HTMLInputElement).value })} /></div>
          <div class="field"><label for="pl-street">Street</label><input id="pl-street" aria-label="Street" value={plan.street ?? ''} onInput={(e) => setPlan({ ...plan, street: (e.target as HTMLInputElement).value })} /></div>
          <div class="field"><label for="pl-postcode">Postcode</label><input id="pl-postcode" aria-label="Postcode" value={plan.postcode ?? ''} onInput={(e) => setPlan({ ...plan, postcode: (e.target as HTMLInputElement).value })} /></div>
          <div class="field"><label for="pl-city">City</label><input id="pl-city" aria-label="City" value={plan.city ?? ''} onInput={(e) => setPlan({ ...plan, city: (e.target as HTMLInputElement).value })} /></div>
          <div class="field"><label for="pl-note">Note to workshop</label><input id="pl-note" aria-label="Note to workshop" value={plan.note ?? ''} onInput={(e) => setPlan({ ...plan, note: (e.target as HTMLInputElement).value })} /></div>
          <button class="primary" onClick={() => { void save(); }}>Save plan</button>
        </div>
      ) : null}
      <p role="status" aria-live="polite" aria-label="Plan status" class="status-line">{status}</p>
    </div>
  );
}

export function NotFound(): ComponentChild {
  return (
    <main class="narrow not-found">
      <h1>We couldn't find that page.</h1>
      <p><a href="/" data-route>Back to the story</a></p>
    </main>
  );
}

