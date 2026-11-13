import { useEffect, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { api, ApiFailure } from '../lib/api.js';
import { navigate, usePolling } from '../lib/router.js';
import { announce, LoadingPanel, ErrorPanel } from '../app.js';
import { store, useStore, onLiveEvent } from '../lib/store.js';
import { rupees, dateTimeText, CONFIG } from '../lib/format.js';
import { Dialog } from '../components/dialog.js';

type OrderBody = {
  number: string; status: string; version: number;
  placed_at: string; delivered_at: string | null;
  confirmation_emailed_at: string | null;
  payment: { status: string; amount: number; card_amount: number; gift_card_amount: number; card_last4: string | null; refunded: number };
  email: string; phone: string | null;
  lines: OrderLine[];
  totals: { subtotal: number; discount: number; shipping: number; tax: number; gift_card: number; total: number };
  timeline: { status: string; label: string; at: string }[];
  return_window: { ends_at: string | null; seconds_left: number | null; open: boolean };
  trial_window: { ends_at: string | null; seconds_left: number | null; open: boolean };
  server_time: string;
};

export type OrderLine = {
  id: number; sku: string; product_slug: string; product: string; colour: string; size: string; quantity: number;
  unit_price: number; line_subtotal: number; line_discount: number; line_tax: number;
  fulfillment: string; shipment: { carrier: string; tracking_number: string } | null;
  return_eligible: boolean; trial_eligible: boolean;
  warranty: { registration_id: number; covered_until: string } | null;
};

const STATUS_WORDS: Record<string, string> = {
  placed: 'Placed', packed: 'Packed', partially_shipped: 'Partially shipped', shipped: 'Shipped',
  out_for_delivery: 'Out for delivery', delivered: 'Delivered', cancelled: 'Cancelled',
};

export function Order(props: { number: string }): JSX.Element {
  const [body, setBody] = useState<OrderBody | null>(null);
  const [failed, setFailed] = useState(false);
  const [dialog, setDialog] = useState<'return' | 'trial' | 'claim' | 'cancel' | null>(null);
  const [caseAlert, setCaseAlert] = useState<string | null>(null);
  useStore();

  const load = async (): Promise<void> => {
    try {
      setBody(await api.get<OrderBody>(`/api/orders/${props.number}`));
    } catch (err) {
      if (err instanceof ApiFailure && err.status === 404) setFailed(true);
    }
  };

  useEffect(() => {
    void load();
  }, [props.number]);

  // Live order updates reach the open page without a reload.
  useEffect(() => {
    const handler = (type: string, data: Record<string, unknown>): void => {
      if (type === 'order' && data.number === props.number) void load();
    };
    return onLiveEvent(handler);
  }, [props.number]);

  usePolling(() => { void load(); }, 30000);

  if (failed) return <ErrorPanel message="We couldn't find that." />;
  if (body === null) return <LoadingPanel />;

  const cancellable = body.status === 'placed' || body.status === 'packed';

  return (
    <div class="order-page">
      <div class="left-zone">
        <p>Return window: {daysHours(body.return_window.seconds_left)} left</p>
        <p>Trial window: {daysHours(body.trial_window.seconds_left)} left</p>
      </div>
      <div class="order-main">
        <h1>Order {body.number}</h1>
        <p role="status" aria-live="polite" class="status-line">Order status: {STATUS_WORDS[body.status] ?? body.status}</p>
        <p role="status" aria-live="polite" class="status-line">Payment status: {paymentWord(body.payment.status)}</p>
        {caseAlert !== null ? <p role="alert" class="alert-panel">{caseAlert}</p> : null}
        <ol role="list" aria-label="Order timeline" class="timeline">
          {body.timeline.map((t) => (
            <li key={`${t.status}-${t.at}`}>{t.label} — {dateTimeText(t.at)}</li>
          ))}
        </ol>
        <ul class="order-lines" role="list">
          {body.lines.map((line) => (
            <li key={line.id}>
              <div role="group" aria-label={`${line.product} — ${line.colour}, ${line.size}`} class="order-line">
                <p>{line.product} — {line.colour}, {line.size}</p>
                <p class="muted">{line.sku} · {rupees(line.unit_price)} × {line.quantity}</p>
                {line.shipment !== null ? <p>{line.shipment.carrier} {line.shipment.tracking_number}</p> : null}
                <div class="line-actions">
                  {line.return_eligible ? <button onClick={() => setDialog('return')} data-line={line.id}>Request return</button> : null}
                  {line.trial_eligible ? <button onClick={() => setDialog('trial')} data-line={line.id}>Send back from trial</button> : null}
                  {line.warranty === null && line.fulfillment === 'delivered' ? <button onClick={() => { void registerWarranty(line.id); }}>Register warranty</button> : null}
                  {line.warranty !== null ? <button onClick={() => setDialog('claim')} data-line={line.id}>Make a warranty claim</button> : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
        <dl class="order-totals">
          <div><dt>Subtotal</dt><dd>{rupees(body.totals.subtotal)}</dd></div>
          <div><dt>Discount</dt><dd>{body.totals.discount > 0 ? `-${rupees(body.totals.discount)}` : rupees(0)}</dd></div>
          <div><dt>Shipping</dt><dd>{body.totals.shipping === 0 ? 'Free' : rupees(body.totals.shipping)}</dd></div>
          <div><dt>Tax</dt><dd>{rupees(body.totals.tax)}</dd></div>
          <div><dt>Gift card</dt><dd>{body.totals.gift_card > 0 ? `-${rupees(body.totals.gift_card)}` : rupees(0)}</dd></div>
          <div><dt>Total</dt><dd>{rupees(body.totals.total)}</dd></div>
        </dl>
        {cancellable ? <button class="secondary" onClick={() => setDialog('cancel')}>Cancel order</button> : null}
      </div>

      {dialog === 'cancel' ? <CancelDialog number={props.number} onClose={() => setDialog(null)} onDone={() => { void load(); }} /> : null}
      {dialog === 'return' ? (
        <ReturnDialog
          number={props.number}
          lineId={activeLineId()}
          onClose={() => setDialog(null)}
          onDone={(message) => { setCaseAlert(message); announce('cart-updates', message); void load(); }}
        />
      ) : null}
      {dialog === 'trial' ? (
        <TrialDialog
          lineId={activeLineId()}
          onClose={() => setDialog(null)}
          onDone={(message) => { setCaseAlert(message); announce('cart-updates', message); void load(); }}
        />
      ) : null}
      {dialog === 'claim' ? (
        <ClaimDialog
          registrationId={activeRegistrationId()}
          onClose={() => setDialog(null)}
          onDone={(message) => { setCaseAlert(message); announce('cart-updates', message); void load(); }}
        />
      ) : null}
    </div>
  );

  function activeLineId(): number {
    const el = document.querySelector<HTMLButtonElement>('[data-line]');
    return el !== null ? Number(el.dataset.line) : (body?.lines[0]?.id ?? 0);
  }

  function activeRegistrationId(): number {
    const line = body?.lines.find((l) => l.warranty !== null);
    return line?.warranty?.registration_id ?? 0;
  }

  async function registerWarranty(lineId: number): Promise<void> {
    try {
      const result = await api.post<{ id: number; covered_until: string }>('/api/warranty/registrations', { order_line_id: lineId });
      announce('cart-updates', `Covered until ${dateTimeText(result.covered_until)}`);
      await load();
    } catch (err) {
      if (err instanceof ApiFailure) announce('cart-updates', err.body.message);
    }
  }
}

function daysHours(seconds: number | null): string {
  if (seconds === null) return '0 days 0 hours';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  return `${days} days ${hours} hours`;
}

function paymentWord(status: string): string {
  const words: Record<string, string> = {
    pending: 'Pending', authorized: 'Authorized', captured: 'Paid', partially_refunded: 'Partially refunded',
    refunded: 'Refunded', failed: 'Failed',
  };
  return words[status] ?? status;
}

function CancelDialog(props: { number: string; onClose: () => void; onDone: () => void }): JSX.Element {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog label="Cancel this order?" open alert onClose={props.onClose} initialFocus="keep">
      <h2>Cancel this order?</h2>
      <button class="primary" onClick={props.onClose}>Keep order</button>
      <button class="secondary" disabled={busy} onClick={async () => {
        setBusy(true);
        try {
          await api.post(`/api/orders/${props.number}/cancel`);
          props.onClose();
          props.onDone();
          const heading = document.querySelector<HTMLElement>('.order-main h1');
          if (heading !== null) heading.focus();
        } finally {
          setBusy(false);
        }
      }}>{busy ? 'Cancelling' : 'Yes, cancel order'}</button>
    </Dialog>
  );
}

function ReturnDialog(props: { number: string; lineId: number; onClose: () => void; onDone: (message: string) => void }): JSX.Element {
  const [reason, setReason] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [outcome, setOutcome] = useState('refund');
  const [exchangeSku, setExchangeSku] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idemKey = useRefKey();

  const REASONS = ['Changed my mind', 'Wrong size', 'Colour not as expected', 'Arrived damaged', 'Other'];

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ number: string }>('/api/returns', {
        order_line_id: props.lineId, quantity, reason, outcome,
        exchange_sku: outcome === 'exchange' ? exchangeSku : null,
      }, { 'Idempotency-Key': idemKey });
      props.onClose();
      props.onDone(`Return ${result.number} requested.`);
    } catch (err) {
      if (err instanceof ApiFailure) setError(err.body.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog label="Request a return" open onClose={props.onClose}>
      <h2>Request a return</h2>
      <fieldset>
        <legend>Reason</legend>
        <div role="radiogroup" aria-label="Reason" class="radios">
          {REASONS.map((r) => (
            <label key={r} class={`radio ${reason === r ? 'selected' : ''}`}>
              <input type="radio" name="reason" value={r} checked={reason === r} onChange={() => setReason(r)} />
              <span>{r}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label>
        <span>Quantity to return</span>
        <input type="number" role="spinbutton" min={1} max={10} value={quantity} onInput={(e) => setQuantity(Number((e.target as HTMLInputElement).value))} />
      </label>
      <fieldset>
        <legend>Outcome</legend>
        <div role="radiogroup" aria-label="Outcome" class="radios">
          <label class={`radio ${outcome === 'refund' ? 'selected' : ''}`}>
            <input type="radio" name="outcome" value="refund" checked={outcome === 'refund'} onChange={() => setOutcome('refund')} />
            <span>Refund</span>
          </label>
          <label class={`radio ${outcome === 'exchange' ? 'selected' : ''}`}>
            <input type="radio" name="outcome" value="exchange" checked={outcome === 'exchange'} onChange={() => setOutcome('exchange')} />
            <span>Exchange</span>
          </label>
        </div>
      </fieldset>
      {outcome === 'exchange' ? (
        <fieldset>
          <legend>Exchange for</legend>
          <div role="radiogroup" aria-label="Exchange for" class="radios">
            <ExchangeOptions lineId={props.lineId} value={exchangeSku} onChange={setExchangeSku} />
          </div>
        </fieldset>
      ) : null}
      {error !== null ? <p role="alert" class="field-error">{error}</p> : null}
      <button class="primary" disabled={busy} onClick={() => { void submit(); }}>{busy ? 'Submitting' : 'Submit return request'}</button>
    </Dialog>
  );
}

/** One Idempotency-Key reused from opening to closing a case dialog. */
function useRefKey(): string {
  const [key] = useState(() => randomKey());
  return key;
}

function randomKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function ExchangeOptions(props: { lineId: number; value: string | null; onChange: (sku: string) => void }): JSX.Element {
  const [options, setOptions] = useState<{ sku: string; colour: string; size: string; price: number; available: number }[]>([]);

  useEffect(() => {
    void (async () => {
      // Candidates: every other variant of the same product at the same price.
      const line = await findLine(props.lineId);
      if (line === null) return;
      const detail = await api.get<{ variants: { sku: string; colour: string; size: string; price: number; available: number }[] }>(`/api/products/${line.product_slug}`).catch(() => null);
      if (detail === null) return;
      setOptions(detail.variants.filter((v) => v.sku !== line.sku && v.price === line.unit_price));
    })();
  }, [props.lineId]);

  return <>{options.map((o) => (
    <label key={o.sku} class={`radio ${props.value === o.sku ? 'selected' : ''}`}>
      <input type="radio" name="exchange" value={o.sku} checked={props.value === o.sku} onChange={() => props.onChange(o.sku)} disabled={o.available <= 0} />
      <span>{o.colour}, {o.size}</span>
    </label>
  ))}</>;
}

/** Finds an order line by id by scanning the customer's orders. */
async function findLine(lineId: number): Promise<{ sku: string; product_slug: string; unit_price: number } | null> {
  const orderList = await api.get<{ number: string }[]>('/api/orders');
  for (const order of orderList) {
    const detail = await api.get<{ lines: { id: number; sku: string; product_slug: string; unit_price: number }[] }>(`/api/orders/${order.number}`).catch(() => null);
    if (detail === null) continue;
    const line = detail.lines.find((l) => l.id === lineId);
    if (line !== undefined) return line;
  }
  return null;
}

function TrialDialog(props: { lineId: number; onClose: () => void; onDone: (message: string) => void }): JSX.Element {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idemKey = useRefKey();

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ number: string }>('/api/trials', { order_line_id: props.lineId, note }, { 'Idempotency-Key': idemKey });
      props.onClose();
      props.onDone(`Trial return ${result.number} requested.`);
    } catch (err) {
      if (err instanceof ApiFailure) setError(err.body.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog label="Send back from trial" open onClose={props.onClose}>
      <h2>Send back from trial</h2>
      <label>
        <span>How did it travel?</span>
        <textarea value={note} onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)} maxlength={500} />
      </label>
      {error !== null ? <p role="alert" class="field-error">{error}</p> : null}
      <button class="primary" disabled={busy} onClick={() => { void submit(); }}>{busy ? 'Submitting' : 'Submit trial return'}</button>
    </Dialog>
  );
}

function ClaimDialog(props: { registrationId: number; onClose: () => void; onDone: (message: string) => void }): JSX.Element {
  const [component, setComponent] = useState('');
  const [description, setDescription] = useState('');
  const [evidence, setEvidence] = useState<{ id: number; kind: string; filename: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idemKey = useRefKey();

  const COMPONENTS = ['Wheels', 'Handle', 'Shell', 'Zipper', 'Lock'];

  const uploadFile = async (kind: 'photo' | 'receipt', file: File): Promise<void> => {
    setError(null);
    announce('upload-progress', `Uploading ${file.name}`);
    const form = new FormData();
    form.append('kind', kind);
    form.append('file', file);
    const res = await fetch('/api/warranty/evidence', { method: 'POST', body: form, credentials: 'same-origin' });
    const body = await res.json();
    if (!res.ok) {
      setError(`${file.name}: ${body.message}`);
      return;
    }
    setEvidence((list) => [...list, { id: body.id, kind, filename: body.filename }]);
    announce('upload-progress', `Uploaded ${file.name}`);
  };

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ number: string }>('/api/warranty/claims', {
        registration_id: props.registrationId,
        component, description,
        evidence_ids: evidence.map((e) => e.id),
      }, { 'Idempotency-Key': idemKey });
      props.onClose();
      props.onDone(`Claim ${result.number} submitted.`);
    } catch (err) {
      if (err instanceof ApiFailure) setError(err.body.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog label="Warranty claim" open onClose={props.onClose}>
      <h2>Warranty claim</h2>
      <fieldset>
        <legend>Component</legend>
        <div role="radiogroup" aria-label="Component" class="radios">
          {COMPONENTS.map((c) => (
            <label key={c} class={`radio ${component === c ? 'selected' : ''}`}>
              <input type="radio" name="component" value={c} checked={component === c} onChange={() => setComponent(c)} />
              <span>{c}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label>
        <span>What happened?</span>
        <textarea value={description} onInput={(e) => setDescription((e.target as HTMLTextAreaElement).value)} />
      </label>
      <div class="evidence-buttons">
        <label class="file-button">
          <span>Add photo</span>
          <input type="file" accept="image/jpeg,image/png,image/webp" aria-label="Evidence photo" onChange={(e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (file !== undefined) void uploadFile('photo', file);
          }} />
        </label>
        <label class="file-button">
          <span>Add receipt</span>
          <input type="file" accept="application/pdf" aria-label="Receipt PDF" onChange={(e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (file !== undefined) void uploadFile('receipt', file);
          }} />
        </label>
      </div>
      <ul role="list" aria-label="Evidence" class="evidence-list">
        {evidence.map((e) => <li key={e.id}>{e.filename} — Evidence stored</li>)}
      </ul>
      {error !== null ? <p role="alert" class="field-error">{error}</p> : null}
      <button class="primary" disabled={busy} onClick={() => { void submit(); }}>{busy ? 'Submitting' : 'Submit claim'}</button>
    </Dialog>
  );
}
