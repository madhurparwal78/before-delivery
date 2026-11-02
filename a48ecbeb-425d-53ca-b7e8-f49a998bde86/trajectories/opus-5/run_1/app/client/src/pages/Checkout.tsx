import { useEffect, useRef, useState, type ReactElement } from 'react';
import { PROVINCES, provinceName, type ProvinceCode } from '../../../shared/catalogue.js';
import { checkoutCopy, crateCopy } from '../../../shared/copy.js';
import { formatCents } from '../../../shared/money.js';
import { ApiCallError, api, type AddressPayload, type OrderPayload } from '../api.js';
import { HoldTimer } from '../components/HoldTimer.js';
import { TotalsTable } from '../components/TotalsPanel.js';
import { Link, useRouter } from '../router.js';
import { useShop } from '../state/shop.js';

type Step = 1 | 2 | 3;

const STEP_HEADINGS: Readonly<Record<Step, string>> = {
  1: 'Step 1 of 3: Address',
  2: 'Step 2 of 3: Review',
  3: 'Step 3 of 3: Payment',
};

const SLOW_PAYMENT_MS = 20_000;

function newAttemptKey(): string {
  return `ceibo-${crypto.randomUUID()}`;
}

const FIELD_LABELS: Record<string, string> = {
  card_number: 'Card number',
  card_expiry: 'Expiry (MM/YY)',
  card_cvc: 'Security code',
  name: 'Full name',
  line1: 'Street address',
  city: 'City',
  postal_code: 'Postal code',
  province: 'Province',
  address_id: 'Ship to',
  cadence: 'Deliver every',
};

export function Checkout(): ReactElement {
  const { cart, quote, user, holdExpired, refreshCart, refreshFlavours, setProvince } = useShop();
  const { navigate } = useRouter();

  const [step, setStep] = useState<Step>(1);
  const [addresses, setAddresses] = useState<AddressPayload[]>([]);
  const [addressId, setAddressId] = useState<string | null>(null);
  const [addingAddress, setAddingAddress] = useState(false);
  const [newAddress, setNewAddress] = useState({
    name: '',
    line1: '',
    line2: '',
    city: '',
    postal_code: '',
    province: 'ON' as ProvinceCode,
    is_default: false,
  });
  const [cardNumber, setCardNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvc, setCvc] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState('');
  const [paying, setPaying] = useState(false);
  const [attemptKey, setAttemptKey] = useState<string>(newAttemptKey);

  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const summaryRef = useRef<HTMLDivElement | null>(null);
  const slowTimer = useRef<number | null>(null);

  useEffect(() => {
    void api
      .get<{ addresses: AddressPayload[] }>('/api/addresses')
      .then((payload) => {
        setAddresses(payload.addresses);
        setAddressId(
          (current) => current ?? payload.addresses.find((item) => item.is_default)?.id ?? null,
        );
      })
      .catch(() => setAddresses([]));
  }, []);

  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  // A new checkout key whenever the crate, address, card or subscribe choice changes.
  useEffect(() => {
    setAttemptKey(newAttemptKey());
  }, [addressId, cart?.count, cart?.subscribe, cart?.cadence, cardNumber, expiry, cvc]);

  const address = addresses.find((item) => item.id === addressId) ?? null;

  // The summary and the Pay button always show the server's quote for the
  // chosen address's province, so the crate's province follows the address.
  useEffect(() => {
    if (address === null || cart === null) return;
    if (cart.province === address.province) return;
    void setProvince(address.province);
  }, [address, cart, setProvince]);

  const totalCents = quote?.total_cents ?? 0;

  const saveAddress = async () => {
    setErrors({});
    try {
      const payload = await api.post<{ address: AddressPayload }>('/api/addresses', newAddress);
      setAddresses((current) => [payload.address, ...current]);
      setAddressId(payload.address.id);
      setAddingAddress(false);
    } catch (error) {
      if (error instanceof ApiCallError && error.failure.fields !== undefined) {
        setErrors(error.failure.fields);
      } else if (error instanceof ApiCallError) {
        setStatus(error.failure.message);
      }
    }
  };

  const pay = async () => {
    setErrors({});
    setPaying(true);
    setStatus(checkoutCopy.pending);
    slowTimer.current = window.setTimeout(() => {
      setStatus(checkoutCopy.slow);
      setPaying(false);
    }, SLOW_PAYMENT_MS);

    const [month, year] = expiry.split('/').map((part) => part.trim());
    try {
      const payload = await api.post<{ order: OrderPayload; subscription_id?: string }>(
        '/api/checkout',
        {
          address_id: addressId,
          subscribe: cart?.subscribe === true,
          cadence: cart?.subscribe === true ? (cart?.cadence ?? 'monthly') : null,
          card: {
            number: cardNumber.replace(/\s+/g, ''),
            expiry_month: Number(month),
            expiry_year: year === undefined ? 0 : 2000 + Number(year),
            cvc,
          },
        },
        { 'idempotency-key': attemptKey },
      );
      void refreshCart();
      void refreshFlavours();
      navigate(payload.order.thank_you_url);
    } catch (error) {
      if (!(error instanceof ApiCallError)) throw error;
      const failure = error.failure;
      if (failure.fields !== undefined) setErrors(failure.fields);
      if (error.status === 402) setStatus(checkoutCopy.declined);
      else if (failure.error === 'billing_unavailable') setStatus(checkoutCopy.billingOutage);
      else if (failure.error === 'files_unavailable') setStatus(checkoutCopy.filesOutage);
      else if (failure.error === 'store_unavailable') setStatus(checkoutCopy.storeOutage);
      else if (failure.error === 'hold_expired') {
        setStatus(crateCopy.holdExpired);
        void refreshCart();
      } else if (failure.fields !== undefined) setStatus('');
      else setStatus(failure.message);
      setPaying(false);
      if (failure.fields !== undefined) summaryRef.current?.focus();
    } finally {
      if (slowTimer.current !== null) window.clearTimeout(slowTimer.current);
      slowTimer.current = null;
    }
  };

  if (user === null) {
    return (
      <div className="page paper">
        <h1>Sign in to check out</h1>
        <Link to="/sign-in?next=/checkout" className="button button--primary">
          Sign in
        </Link>
      </div>
    );
  }

  const fieldErrors = Object.entries(errors);

  return (
    <div className="checkout" data-step={step}>
      <div className="checkout__steps paper">
        <HoldTimer />
        <h1 tabIndex={-1} ref={headingRef} className="checkout__heading">
          {STEP_HEADINGS[step]}
        </h1>

        {fieldErrors.length > 0 ? (
          <div role="alert" aria-label="Fix these fields" className="error-summary" tabIndex={-1} ref={summaryRef}>
            <h2>Fix these fields</h2>
            <ul>
              {fieldErrors.map(([field, message]) => (
                <li key={field}>
                  <a
                    href={`#field-${field}`}
                    onClick={(event) => {
                      event.preventDefault();
                      document.getElementById(`field-${field}`)?.focus();
                    }}
                  >
                    {FIELD_LABELS[field] ?? field}: {message}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {holdExpired ? (
          <>
            <p className="notice notice--warn">{crateCopy.holdExpired}</p>
            <Link to="/box" className="button button--primary">
              Back to your crate
            </Link>
          </>
        ) : (
          <>
            {step === 1 ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (addressId !== null) setStep(2);
                }}
              >
                <fieldset className="radiogroup radiogroup--stacked">
                  <legend>Ship to</legend>
                  {addresses.map((item) => (
                    <label key={item.id}>
                      <input
                        type="radio"
                        name="address"
                        value={item.id}
                        id={`field-address_id`}
                        checked={addressId === item.id}
                        onChange={() => setAddressId(item.id)}
                      />
                      <span>
                        {item.name}, {item.line1}
                        {item.line2 === '' ? '' : `, ${item.line2}`}, {item.city},{' '}
                        {provinceName(item.province)} {item.postal_code}
                      </span>
                    </label>
                  ))}
                </fieldset>

                {addingAddress ? (
                  <div className="address-form">
                    <div className="field">
                      <label htmlFor="field-name">Full name</label>
                      <input
                        id="field-name"
                        value={newAddress.name}
                        onChange={(event) =>
                          setNewAddress((current) => ({ ...current, name: event.target.value }))
                        }
                      />
                      {errors.name === undefined ? null : <p className="field__error">{errors.name}</p>}
                    </div>
                    <div className="field">
                      <label htmlFor="field-line1">Street address</label>
                      <input
                        id="field-line1"
                        value={newAddress.line1}
                        onChange={(event) =>
                          setNewAddress((current) => ({ ...current, line1: event.target.value }))
                        }
                      />
                      {errors.line1 === undefined ? null : <p className="field__error">{errors.line1}</p>}
                    </div>
                    <div className="field">
                      <label htmlFor="field-line2">Apartment or unit (optional)</label>
                      <input
                        id="field-line2"
                        value={newAddress.line2}
                        onChange={(event) =>
                          setNewAddress((current) => ({ ...current, line2: event.target.value }))
                        }
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="field-city">City</label>
                      <input
                        id="field-city"
                        value={newAddress.city}
                        onChange={(event) =>
                          setNewAddress((current) => ({ ...current, city: event.target.value }))
                        }
                      />
                      {errors.city === undefined ? null : <p className="field__error">{errors.city}</p>}
                    </div>
                    <div className="field">
                      <label htmlFor="field-postal_code">Postal code</label>
                      <input
                        id="field-postal_code"
                        value={newAddress.postal_code}
                        onChange={(event) =>
                          setNewAddress((current) => ({
                            ...current,
                            postal_code: event.target.value,
                          }))
                        }
                      />
                      {errors.postal_code === undefined ? null : (
                        <p className="field__error">{errors.postal_code}</p>
                      )}
                    </div>
                    <div className="field">
                      <label htmlFor="field-province">Province</label>
                      <select
                        id="field-province"
                        value={newAddress.province}
                        onChange={(event) =>
                          setNewAddress((current) => ({
                            ...current,
                            province: event.target.value as ProvinceCode,
                          }))
                        }
                      >
                        {PROVINCES.map((province) => (
                          <option key={province.code} value={province.code}>
                            {province.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        checked={newAddress.is_default}
                        onChange={(event) =>
                          setNewAddress((current) => ({
                            ...current,
                            is_default: event.target.checked,
                          }))
                        }
                      />
                      Make this my default address
                    </label>
                    <button
                      type="button"
                      className="button button--primary"
                      onClick={() => void saveAddress()}
                    >
                      Save address
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="button button--quiet"
                    onClick={() => setAddingAddress(true)}
                  >
                    Add a new address
                  </button>
                )}

                <div className="checkout__nav">
                  <button type="submit" className="button button--primary" disabled={addressId === null}>
                    Continue
                  </button>
                </div>
              </form>
            ) : null}

            {step === 2 ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  setStep(3);
                }}
              >
                <p>
                  Shipping to {address?.city}, {address === null ? '' : provinceName(address.province)}.
                </p>
                <p>
                  {cart?.subscribe === true
                    ? `Subscribe and save is on, delivered every ${cart.cadence === 'monthly' ? 'month' : 'two months'}.`
                    : 'This is a one-off crate.'}
                </p>
                <div className="checkout__nav">
                  <button type="button" className="button button--quiet" onClick={() => setStep(1)}>
                    Back
                  </button>
                  <button type="submit" className="button button--primary">
                    Continue
                  </button>
                </div>
              </form>
            ) : null}

            {step === 3 ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void pay();
                }}
              >
                <div className="field">
                  <label htmlFor="field-card_number">Card number</label>
                  <input
                    id="field-card_number"
                    className="mono"
                    inputMode="numeric"
                    autoComplete="cc-number"
                    value={cardNumber}
                    onChange={(event) => setCardNumber(event.target.value)}
                  />
                  {errors.card_number === undefined ? null : (
                    <p className="field__error">{errors.card_number}</p>
                  )}
                </div>
                <div className="field">
                  <label htmlFor="field-card_expiry">Expiry (MM/YY)</label>
                  <input
                    id="field-card_expiry"
                    className="mono"
                    inputMode="numeric"
                    placeholder="MM/YY"
                    autoComplete="cc-exp"
                    value={expiry}
                    onChange={(event) => setExpiry(event.target.value)}
                  />
                  {errors.card_expiry === undefined ? null : (
                    <p className="field__error">{errors.card_expiry}</p>
                  )}
                </div>
                <div className="field">
                  <label htmlFor="field-card_cvc">Security code</label>
                  <input
                    id="field-card_cvc"
                    className="mono"
                    inputMode="numeric"
                    autoComplete="cc-csc"
                    value={cvc}
                    onChange={(event) => setCvc(event.target.value)}
                  />
                  {errors.card_cvc === undefined ? null : (
                    <p className="field__error">{errors.card_cvc}</p>
                  )}
                </div>
                <div className="checkout__nav">
                  <button type="button" className="button button--quiet" onClick={() => setStep(2)}>
                    Back
                  </button>
                  <button type="submit" className="button button--primary" disabled={paying}>
                    {paying ? 'Paying...' : `Pay $${formatCents(totalCents)}`}
                  </button>
                </div>
              </form>
            ) : null}
          </>
        )}

        <p role="status" aria-live="polite" aria-label="Checkout status" className="live-region">
          {status}
        </p>
      </div>

      <section className="checkout__summary paper" aria-label="Order summary">
        <h2>Order summary</h2>
        <TotalsTable />
      </section>
    </div>
  );
}
