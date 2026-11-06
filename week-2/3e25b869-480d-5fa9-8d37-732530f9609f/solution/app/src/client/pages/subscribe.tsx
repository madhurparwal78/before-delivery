// Subscribe: pick a Trio scent and cadence, confirm the email, give an address and start.
import { useEffect, useRef, useState } from 'preact/hooks';
import { type Cadence, CORE_SCENTS, pick } from '../../shared/catalog.js';
import { formatMoney, trioPrice } from '../../shared/money.js';
import { api, newKey } from '../api';
import { EmailStep } from '../email-step';
import { serviceStatus, useCopy, useStore } from '../state';
import type { Account, Subscription } from '../types';
import { ADDRESS_ORDER, type Address, AddressFields, CadenceMenu, ErrorSummary, type FieldError, Live, orderedErrors, PriceRows, ProvinceSelect } from '../ui';

export const FLASH = 'pdl_account_flash';

export function TrioScentRadios({ value, onChange, error }: { value: string | null; onChange: (slug: string) => void; error?: string | undefined }) {
  const { m, l } = useCopy();
  return (
    <div class="field">
      <span class="label" id="trio-scent-label">
        {m.trioScent}
      </span>
      <div role="radiogroup" aria-labelledby="trio-scent-label" class="chips" aria-invalid={error ? 'true' : undefined}>
        {CORE_SCENTS.map((s, i) => (
          <label class="chip" key={s.slug}>
            <input
              type="radio"
              name="trio-scent"
              id={i === 0 ? 'f-scent' : undefined}
              value={s.slug}
              checked={value === s.slug}
              onChange={() => onChange(s.slug)}
            />
            <span>{pick(s.name, l)}</span>
          </label>
        ))}
      </div>
      {error && <p class="field-error">{error}</p>}
    </div>
  );
}

export function TrioPrice({ province, charged = true }: { province: string; charged?: boolean }) {
  const { m, l } = useCopy();
  const price = trioPrice(province);
  return (
    <section aria-label={m.trioPrice} class="order-total">
      <h2>{m.trioPrice}</h2>
      <PriceRows rows={[[m.subtotal, price.subtotal], [m.discount, price.discount, true]]} taxes={price.taxes} total={[m.total, price.total]} />
      {charged && (
        <p class="price-row charged">
          <span>{m.chargedToday}</span>
          <span class="num">{formatMoney(price.total.cents, l)}</span>
        </p>
      )}
    </section>
  );
}

const ORDER: [string, string][] = [['scent', 'f-scent'], ['cadence', 'f-cadence'], ...ADDRESS_ORDER];

export function SubscribePage() {
  const { m } = useCopy();
  const status = useStore(serviceStatus);
  const [scent, setScent] = useState<string | null>(null);
  const [cadence, setCadence] = useState<Cadence | null>(null);
  const [province, setProvince] = useState('QC');
  const [signedIn, setSignedIn] = useState<string | null>(null);
  const [address, setAddress] = useState<Address>({ name: '', line1: '', city: '', postal_code: '' });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [starting, setStarting] = useState(false);
  const [message, setMessage] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);
  const key = useRef(newKey());

  useEffect(() => {
    void api<Account>('GET', '/api/account').then((r) => r.ok && setSignedIn(r.data.customer.email));
  }, []);

  const state = starting ? 'starting' : status.billing === 'down' ? 'paused' : !signedIn ? 'verify' : 'ready';
  const label = { starting: m.starting, paused: m.subsPaused, verify: m.verifyFirst, ready: m.start }[state];

  const start = async () => {
    if (state !== 'ready') return;
    setStarting(true);
    const body: Record<string, unknown> = { scent, cadence, shipping: { ...address, province } };
    const r = await api<{ subscription: Subscription; charged_today: { cents: number } }>('POST', '/api/subscriptions', body, {
      'Idempotency-Key': key.current,
    });
    if (r.ok) {
      sessionStorage.setItem(FLASH, JSON.stringify({ kind: 'started', cents: r.data.charged_today.cents }));
      location.assign(`/account/subscriptions/${r.data.subscription.number}`);
      return;
    }
    setStarting(false);
    if (r.status === 0) {
      setMessage(m.network);
      return;
    }
    key.current = newKey();
    if (r.status === 422 && r.error.fields) {
      setFields(r.error.fields);
      setErrors(orderedErrors(r.error.fields, ORDER));
      setAttempt((a) => a + 1);
      return;
    }
    if (r.status === 503) serviceStatus.set({ ...serviceStatus.get(), billing: 'down' });
    setMessage(r.error.message);
  };

  return (
    <div class="page columns">
      <div class="col-main">
        <h1 tabIndex={-1}>{m.trioHeading}</h1>
        <p class="lede">{m.trioIntro}</p>
        <ErrorSummary errors={errors} attempt={attempt} />
        <div class="ruled">
          <TrioScentRadios value={scent} onChange={setScent} error={fields.scent} />
          <CadenceMenu value={cadence} onChoose={setCadence} error={fields.cadence} />
        </div>
        <div class="ruled">
          <ProvinceSelect value={province} onChange={setProvince} error={fields['shipping.province']} />
        </div>
        <div class="ruled narrow-only">
          <TrioPrice province={province} />
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
          <button type="button" class="button primary wide-button" aria-disabled={state === 'ready' ? undefined : 'true'} aria-busy={starting ? 'true' : undefined} onClick={() => void start()}>
            {label}
          </button>
        </div>
        <Live name={m.accountUpdates} text={message} class="result-line" />
      </div>
      <aside class="col-side wide-only">
        <div class="sticky-panel">
          <TrioPrice province={province} />
        </div>
      </aside>
    </div>
  );
}
