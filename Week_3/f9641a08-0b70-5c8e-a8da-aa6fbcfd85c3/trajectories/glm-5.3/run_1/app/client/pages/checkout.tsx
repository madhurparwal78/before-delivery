import { useEffect, useMemo, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { api, ApiFailure } from '../lib/api.js';
import { navigate, usePath, usePolling, useReducedMotion } from '../lib/router.js';
import { announce, LoadingPanel, ErrorPanel, signOut } from '../app.js';
import { store, useStore, onLiveEvent } from '../lib/store.js';
import { rupees, dateText } from '../lib/format.js';
import { Totals } from '../components/baglines.js';
import { Dialog } from '../components/dialog.js';

type CheckoutBody = {
  id: number;
  step: 'contact' | 'delivery' | 'shipping' | 'payment';
  contact: { email: string | null; phone: string | null };
  delivery: { address: Record<string, string> | null };
  shipping_method: string;
  gift: boolean;
  gift_message: string | null;
  lines: { sku: string; product: string; colour: string; size: string; quantity: number; unit_price: number; line_subtotal: number }[];
  totals: { subtotal: number; discount: number; shipping: number; tax: number; gift_card: number; total: number };
  hold: { status: 'none' | 'active' | 'expired'; expires_at: string | null; seconds_left: number | null };
  server_time: string;
};

const STEPS = ['contact', 'delivery', 'shipping', 'payment'] as const;
const STEP_NAMES: Record<string, string> = { contact: 'Contact', delivery: 'Delivery', shipping: 'Shipping', payment: 'Payment' };

export function Checkout(props: { id: number }): JSX.Element {
  const [body, setBody] = useState<CheckoutBody | null>(null);
  const [failed, setFailed] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [payBusy, setPayBusy] = useState(false);
  const [orderNumber, setOrderNumber] = useState<string | null>(null);
  const [holdAlert, setHoldAlert] = useState<string | null>(null);
  const path = usePath();
  const reduced = useReducedMotion();
  useStore();

  const load = async (): Promise<void> => {
    try {
      const fresh = await api.get<CheckoutBody>(`/api/checkout/${props.id}`);
      setBody(fresh);
      setHoldAlert(null);
    } catch (err) {
      if (err instanceof ApiFailure && err.status === 404) setFailed(true);
    }
  };

  useEffect(() => {
    void load();
  }, [props.id]);

  useEffect(() => {
    if (body !== null) announce('checkout-updates', `Step ${STEPS.indexOf(body.step) + 1} of 4: ${STEP_NAMES[body.step]}`);
  }, [body?.step]);

  // Re-sync hold status when the tab becomes visible and every 30 seconds.
  usePolling(() => { void load(); }, 30000);

  if (orderNumber !== null) {
    return (
      <section class="panel confirmation">
        <h1 tabIndex={-1} ref={(el) => { if (el instanceof HTMLElement) el.focus(); }}>Thank you — order {orderNumber} is placed.</h1>
        <p>Confirmation emailed to {body?.contact.email}.</p>
      </section>
    );
  }

  if (failed) return <ErrorPanel message="We couldn't find that." />;
  if (body === null) return <LoadingPanel />;

  const stepIndex = STEPS.indexOf(body.step);
  const next = (form: Record<string, unknown>): Promise<void> => loadAfter(async () => {
    const fresh = await api.patch<CheckoutBody>(`/api/checkout/${props.id}`, form);
    setBody(fresh);
    const heading = document.querySelector(`#step-${fresh.step}`);
    if (heading instanceof HTMLElement) heading.focus();
  });

  const loadAfter = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setFields({});
    try {
      await fn();
    } catch (err) {
      if (err instanceof ApiFailure) setFields(err.body.fields ?? {});
    } finally {
      setBusy(false);
    }
  };

  const goBack = async (): Promise<void> => {
    const target = STEPS[Math.max(0, stepIndex - 1)];
    await loadAfter(async () => {
      const fresh = await api.patch<CheckoutBody>(`/api/checkout/${props.id}`, { step: body.step, go: true });
      void fresh;
      const back = await api.patch<CheckoutBody>(`/api/checkout/${props.id}`, { step: target, go: true });
      setBody(back);
    });
  };

  return (
    <div class="checkout-page">
      <h1>Checkout</h1>
      <div class="checkout-layout">
        <aside class="left-zone">
          <ol role="list" aria-label="Checkout progress" class="progress">
            {STEPS.map((step, i) => (
              <li key={step} aria-current={step === body.step ? 'step' : undefined} class={step === body.step ? 'current' : i < stepIndex ? 'done' : ''}>
                {STEP_NAMES[step]}
              </li>
            ))}
          </ol>
          <Totals />
        </aside>
        <div class="checkout-form">
          {holdAlert !== null ? <p role="alert" class="alert-panel">{holdAlert}</p> : null}
          {fields.general !== undefined ? <p role="alert" class="alert-panel">{fields.general}</p> : null}
          <ErrorSummary fields={fields} />
          {body.step === 'contact' ? <ContactStep body={body} busy={busy} fields={fields} onNext={next} /> : null}
          {body.step === 'delivery' ? <DeliveryStep body={body} busy={busy} fields={fields} onNext={next} /> : null}
          {body.step === 'shipping' ? <ShippingStep body={body} busy={busy} fields={fields} onNext={next} /> : null}
          {body.step === 'payment' ? (
            <PaymentStep
              body={body}
              busy={payBusy}
              fields={fields}
              onHoldChange={setBody}
              onPay={async (card) => {
                setPayBusy(true);
                setFields({});
                // Pay first places the hold, then submits the order with one key per attempt.
                try {
                  await api.post(`/api/checkout/${props.id}/reserve`);
                  const fresh = await api.get<CheckoutBody>(`/api/checkout/${props.id}`);
                  setBody(fresh);
                  const order = await api.post<{ number: string }>('/api/orders', { checkout_id: props.id, card }, {
                    'Idempotency-Key': idempotencyKey(),
                  });
                  setOrderNumber(order.number);
                  await store.refreshAll();
                } catch (err) {
                  if (err instanceof ApiFailure) {
                    if (err.body.error === 'reservation_expired' || err.body.error === 'out_of_stock') {
                      setHoldAlert(err.body.message);
                    } else {
                      setFields(err.body.fields ?? { general: err.body.message });
                    }
                  }
                } finally {
                  setPayBusy(false);
                }
              }}
            />
          ) : null}
          {stepIndex > 0 ? <button class="secondary" onClick={() => { void goBack(); }}>Back</button> : null}
        </div>
      </div>
    </div>
  );
}

/** One Idempotency-Key per payment attempt, kept until the card fields change. */
let paymentKey: string | null = null;
let cardFingerprint: string | null = null;

function idempotencyKey(): string {
  const fingerprint = cardFingerprint ?? 'none';
  if (paymentKey === null || fingerprint !== fingerprint) {
    paymentKey = randomKey();
    cardFingerprint = fingerprint;
  }
  return paymentKey;
}

export function noteCardChange(fingerprint: string): void {
  if (fingerprint !== cardFingerprint) {
    cardFingerprint = fingerprint;
    paymentKey = null;
  }
}

function randomKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function ErrorSummary(props: { fields: Record<string, string> }): JSX.Element {
  const entries = Object.entries(props.fields);
  if (entries.length === 0) return <></>;
  return (
    <div role="alert" class="error-summary">
      <h2>There is a problem</h2>
      <ul>
        {entries.map(([key, message]) => (
          <li key={key}><a href={`#field-${key.replace(/\./g, '-')}`} onClick={(e) => {
            e.preventDefault();
            const el = document.getElementById(`field-${key.replace(/\./g, '-')}`);
            if (el instanceof HTMLElement) el.focus();
          }}>{message}</a></li>
        ))}
      </ul>
    </div>
  );
}

function ContactStep(props: { body: CheckoutBody; busy: boolean; fields: Record<string, string>; onNext: (form: Record<string, unknown>) => Promise<void> }): JSX.Element {
  const [email, setEmail] = useState(props.body.contact.email ?? '');
  const [phone, setPhone] = useState(props.body.contact.phone ?? '');
  return (
    <fieldset>
      <legend><h2 id="step-contact" tabIndex={-1}>Contact</h2></legend>
      <label>
        <span>Email</span>
        <input id="field-email" type="email" value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} aria-describedby={props.fields.email !== undefined ? 'error-email' : undefined} />
        {props.fields.email !== undefined ? <p id="error-email" class="field-error">{props.fields.email}</p> : null}
      </label>
      <label>
        <span>Mobile number</span>
        <input id="field-phone" type="tel" value={phone} onInput={(e) => setPhone((e.target as HTMLInputElement).value)} aria-describedby={props.fields.phone !== undefined ? 'error-phone' : undefined} />
        {props.fields.phone !== undefined ? <p id="error-phone" class="field-error">{props.fields.phone}</p> : null}
      </label>
      <button class="primary" disabled={props.busy} onClick={() => { void props.onNext({ step: 'contact', email, phone }); }}>{props.busy ? 'Checking' : 'Continue'}</button>
    </fieldset>
  );
}

function DeliveryStep(props: { body: CheckoutBody; busy: boolean; fields: Record<string, string>; onNext: (form: Record<string, unknown>) => Promise<void> }): JSX.Element {
  const [addresses, setAddresses] = useState<{ id: number; label: string; name: string; line1: string; line2: string; city: string; state: string; postcode: string; phone: string }[]>([]);
  const [mode, setMode] = useState<'saved' | 'new'>('new');
  const [addressId, setAddressId] = useState<number | null>(null);
  const [form, setForm] = useState({ label: '', name: '', line1: '', line2: '', city: '', state: '', postcode: '', phone: '' });

  useEffect(() => {
    void api.get<typeof addresses>('/api/addresses').then((list) => {
      setAddresses(list);
      if (list.length > 0) { setMode('saved'); setAddressId(list[0].id); }
    }).catch(() => undefined);
  }, []);

  const STATES = ['Maharashtra', 'Karnataka', 'Delhi', 'Tamil Nadu', 'Telangana', 'West Bengal', 'Gujarat', 'Rajasthan', 'Kerala', 'Punjab', 'Haryana', 'Uttar Pradesh'];

  return (
    <fieldset>
      <legend><h2 id="step-delivery" tabIndex={-1}>Delivery</h2></legend>
      <div role="radiogroup" aria-label="Saved addresses" class="radios">
        {addresses.map((a) => (
          <label key={a.id} class={`radio ${addressId === a.id ? 'selected' : ''}`}>
            <input type="radio" name="address" value={a.id} checked={addressId === a.id} onChange={() => { setMode('saved'); setAddressId(a.id); }} />
            <span>{a.label}</span>
          </label>
        ))}
        <label class={`radio ${mode === 'new' ? 'selected' : ''}`}>
          <input type="radio" name="address" checked={mode === 'new'} onChange={() => { setMode('new'); setAddressId(null); }} />
          <span>New address</span>
        </label>
      </div>
      {mode === 'new' ? (
        <div class="address-form">
          <label><span>Full name</span><input id="field-address-name" value={form.name} onInput={(e) => setForm({ ...form, name: (e.target as HTMLInputElement).value })} aria-describedby={props.fields['address.name'] !== undefined ? 'error-address-name' : undefined} />{props.fields['address.name'] !== undefined ? <p id="error-address-name" class="field-error">{props.fields['address.name']}</p> : null}</label>
          <label><span>Address line 1</span><input id="field-address-line1" value={form.line1} onInput={(e) => setForm({ ...form, line1: (e.target as HTMLInputElement).value })} aria-describedby={props.fields['address.line1'] !== undefined ? 'error-address-line1' : undefined} />{props.fields['address.line1'] !== undefined ? <p id="error-address-line1" class="field-error">{props.fields['address.line1']}</p> : null}</label>
          <label><span>Address line 2</span><input id="field-address-line2" value={form.line2} onInput={(e) => setForm({ ...form, line2: (e.target as HTMLInputElement).value })} aria-describedby={props.fields['address.line2'] !== undefined ? 'error-address-line2' : undefined} />{props.fields['address.line2'] !== undefined ? <p id="error-address-line2" class="field-error">{props.fields['address.line2']}</p> : null}</label>
          <label><span>Town or city</span><input id="field-address-city" value={form.city} onInput={(e) => setForm({ ...form, city: (e.target as HTMLInputElement).value })} aria-describedby={props.fields['address.city'] !== undefined ? 'error-address-city' : undefined} />{props.fields['address.city'] !== undefined ? <p id="error-address-city" class="field-error">{props.fields['address.city']}</p> : null}</label>
          <label>
            <span>State</span>
            <select id="field-address-state" value={form.state} onChange={(e) => setForm({ ...form, state: (e.target as HTMLSelectElement).value })} aria-describedby={props.fields['address.state'] !== undefined ? 'error-address-state' : undefined}>
              <option value="">Choose a state</option>
              {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            {props.fields['address.state'] !== undefined ? <p id="error-address-state" class="field-error">{props.fields['address.state']}</p> : null}
          </label>
          <label><span>PIN code</span><input id="field-address-postcode" value={form.postcode} onInput={(e) => setForm({ ...form, postcode: (e.target as HTMLInputElement).value })} aria-describedby={props.fields['address.postcode'] !== undefined ? 'error-address-postcode' : undefined} />{props.fields['address.postcode'] !== undefined ? <p id="error-address-postcode" class="field-error">{props.fields['address.postcode']}</p> : null}</label>
          <label><span>Mobile number</span><input id="field-address-phone" type="tel" value={form.phone} onInput={(e) => setForm({ ...form, phone: (e.target as HTMLInputElement).value })} aria-describedby={props.fields['address.phone'] !== undefined ? 'error-address-phone' : undefined} />{props.fields['address.phone'] !== undefined ? <p id="error-address-phone" class="field-error">{props.fields['address.phone']}</p> : null}</label>
        </div>
      ) : null}
      <button class="primary" disabled={props.busy} onClick={() => {
        if (mode === 'saved' && addressId !== null) {
          void props.onNext({ step: 'delivery', address_id: addressId });
        } else {
          void props.onNext({ step: 'delivery', address: { ...form, label: form.label === '' ? 'Home' : form.label } });
        }
      }}>{props.busy ? 'Checking' : 'Continue'}</button>
    </fieldset>
  );
}

function ShippingStep(props: { body: CheckoutBody; busy: boolean; fields: Record<string, string>; onNext: (form: Record<string, unknown>) => Promise<void> }): JSX.Element {
  const [method, setMethod] = useState(props.body.shipping_method === 'express' ? 'express' : 'standard');
  const [gift, setGift] = useState(props.body.gift);
  const [giftMessage, setGiftMessage] = useState(props.body.gift_message ?? '');
  return (
    <fieldset>
      <legend><h2 id="step-shipping" tabIndex={-1}>Shipping</h2></legend>
      <div role="radiogroup" aria-label="Shipping method" class="radios">
        <label class={`radio ${method === 'standard' ? 'selected' : ''}`}>
          <input type="radio" name="method" value="standard" checked={method === 'standard'} onChange={() => setMethod('standard')} />
          <span>Standard</span>
        </label>
        <label class={`radio ${method === 'express' ? 'selected' : ''}`}>
          <input type="radio" name="method" value="express" checked={method === 'express'} onChange={() => setMethod('express')} />
          <span>Express</span>
        </label>
      </div>
      <label class="checkbox-row">
        <input type="checkbox" checked={gift} onChange={(e) => setGift((e.target as HTMLInputElement).checked)} />
        <span>This is a gift</span>
      </label>
      {gift ? (
        <label>
          <span>Gift message</span>
          <textarea value={giftMessage} onInput={(e) => setGiftMessage((e.target as HTMLTextAreaElement).value)} aria-describedby={props.fields.gift_message !== undefined ? 'error-gift-message' : undefined} />
          {props.fields.gift_message !== undefined ? <p id="error-gift-message" class="field-error">{props.fields.gift_message}</p> : null}
        </label>
      ) : null}
      <button class="primary" disabled={props.busy} onClick={() => { void props.onNext({ step: 'shipping', method, gift, gift_message: giftMessage }); }}>{props.busy ? 'Checking' : 'Continue'}</button>
    </fieldset>
  );
}

function PaymentStep(props: { body: CheckoutBody; busy: boolean; fields: Record<string, string>; onPay: (card: { number: string; expiry: string; cvc: string } | undefined) => Promise<void>; onHoldChange: (b: CheckoutBody) => void }): JSX.Element {
  const [number, setNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvc, setCvc] = useState('');
  const seconds = props.body.hold.seconds_left;
  const [left, setLeft] = useState<number | null>(seconds);
  const [showCard, setShowCard] = useState(true);

  useEffect(() => setLeft(seconds), [seconds]);

  useEffect(() => {
    if (left === null || left <= 0) return;
    const id = setInterval(() => setLeft((current) => (current === null ? null : current - 1)), 1000);
    return () => clearInterval(id);
  }, [left !== null]);

  useEffect(() => {
    if (left === 60) announce('checkout-updates', 'One minute left on your hold.');
    if (left === 0) {
      void api.get<CheckoutBody>(`/api/checkout/${props.body.id}`).then((fresh) => {
        if (fresh.hold.status !== 'active') {
          announce('checkout-updates', fresh.hold.status === 'expired' ? 'Your hold has ended and the items went back on sale. Press Pay to hold them again.' : '');
        }
        props.onHoldChange(fresh);
      }).catch(() => undefined);
    }
  }, [left]);

  useEffect(() => {
    setShowCard(props.body.totals.total > 0);
  }, [props.body.totals.total]);

  const minutes = left === null ? 0 : Math.floor(left / 60);
  const secs = left === null ? 0 : left % 60;
  const zero = props.body.totals.total === 0;

  return (
    <fieldset>
      <legend><h2 id="step-payment" tabIndex={-1}>Payment</h2></legend>
      {props.body.hold.status === 'active' && left !== null && left > 0 ? (
        <p class="hold-timer"><span role="timer" aria-label="Hold time left">Held for {minutes}:{String(secs).padStart(2, '0')}</span></p>
      ) : null}
      {showCard && !zero ? (
        <>
          <label><span>Card number</span><input id="field-card-number" value={number} onInput={(e) => { const v = (e.target as HTMLInputElement).value; setNumber(v); noteCardChange(v); }} inputMode="numeric" aria-describedby={props.fields['card.number'] !== undefined ? 'error-card-number' : undefined} />{props.fields['card.number'] !== undefined ? <p id="error-card-number" class="field-error">{props.fields['card.number']}</p> : null}</label>
          <label><span>Expiry (MM/YY)</span><input id="field-card-expiry" value={expiry} onInput={(e) => { const v = (e.target as HTMLInputElement).value; setExpiry(v); noteCardChange(v); }} placeholder="MM/YY" aria-describedby={props.fields['card.expiry'] !== undefined ? 'error-card-expiry' : undefined} />{props.fields['card.expiry'] !== undefined ? <p id="error-card-expiry" class="field-error">{props.fields['card.expiry']}</p> : null}</label>
          <label><span>Security code</span><input id="field-card-cvc" value={cvc} onInput={(e) => { const v = (e.target as HTMLInputElement).value; setCvc(v); noteCardChange(v); }} inputMode="numeric" aria-describedby={props.fields['card.cvc'] !== undefined ? 'error-card-cvc' : undefined} />{props.fields['card.cvc'] !== undefined ? <p id="error-card-cvc" class="field-error">{props.fields['card.cvc']}</p> : null}</label>
        </>
      ) : null}
      <button class="primary" disabled={props.busy} onClick={() => {
        void props.onPay(zero ? undefined : { number, expiry, cvc });
      }}>
        {props.busy ? 'Paying' : `Pay ${rupees(props.body.totals.total)}`}
      </button>
    </fieldset>
  );
}
