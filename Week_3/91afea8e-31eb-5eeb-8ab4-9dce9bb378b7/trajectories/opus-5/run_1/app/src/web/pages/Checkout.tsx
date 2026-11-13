/** Checkout in three steps, with one Idempotency-Key per submission. */

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { api, ApiFailure } from '../api.ts';
import { useRouter } from '../router.tsx';
import { useCart, useSession } from '../state.tsx';
import {
  Amount,
  Dialog,
  PendingButton,
  Reel,
  StatusRegion,
  useDesktop,
} from '../components/ui.tsx';
import { NoiseBackdrop } from '../effects/decor.tsx';
import { formatAmount, formatPromiseDate } from '../../shared/format.js';
import { COPY, FIELD } from '../../shared/messages.js';
import type {
  Address,
  CartQuote,
  CheckoutResponse,
  EmiPlansResponse,
  PaymentMethod,
  SavedCard,
} from '../../shared/types.js';

type Step = 'address' | 'payment' | 'review';

const STEP_PATH: Record<Step, string> = {
  address: '/checkout/address',
  payment: '/checkout/payment',
  review: '/checkout/review',
};

const METHOD_LABELS: { value: PaymentMethod; label: string }[] = [
  { value: 'upi', label: 'UPI' },
  { value: 'card', label: 'Card' },
  { value: 'netbanking', label: 'Net banking' },
  { value: 'emi', label: 'EMI' },
  { value: 'cod', label: 'Cash on delivery' },
];

type Kept = {
  addressId: string | null;
  method: PaymentMethod | null;
  useBalance: boolean;
  tenure: number | null;
  vpa: string;
  bank: string;
  savedCardId: string | null;
};

const KEPT_KEY = 'chauraha_checkout';

function readKept(): Kept {
  try {
    const raw = sessionStorage.getItem(KEPT_KEY);
    if (raw !== null) return JSON.parse(raw) as Kept;
  } catch {
    /* an unreadable draft is simply a fresh one */
  }
  return {
    addressId: null,
    method: null,
    useBalance: false,
    tenure: null,
    vpa: '',
    bank: '',
    savedCardId: null,
  };
}

function writeKept(kept: Kept): void {
  sessionStorage.setItem(KEPT_KEY, JSON.stringify(kept));
}

function newKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function CheckoutPage({ step }: { step: Step }): ReactNode {
  const { navigate } = useRouter();
  const { balancePaise } = useSession();
  const { quote, run, refresh } = useCart();
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [cards, setCards] = useState<SavedCard[]>([]);
  const [banks, setBanks] = useState<{ code: string; name: string }[]>([]);
  const [plans, setPlans] = useState<EmiPlansResponse | null>(null);
  const [kept, setKept] = useState<Kept>(() => readKept());
  const [problems, setProblems] = useState('');
  const [newAddressOpen, setNewAddressOpen] = useState(false);
  const [card, setCard] = useState({
    number: '',
    expiry: '',
    cvv: '',
    name: '',
    save: false,
  });
  const [draft, setDraft] = useState({
    label: 'Home',
    name: '',
    line1: '',
    line2: '',
    city: '',
    pincode: '',
    phone: '',
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const desktop = useDesktop();
  const heading = useRef<HTMLHeadingElement | null>(null);
  const idempotencyKey = useRef<string>('');

  useEffect(() => {
    void api<{ addresses: Address[] }>('/api/account/addresses')
      .then((response) => setAddresses(response.addresses))
      .catch(() => setAddresses([]));
    void api<{ cards: SavedCard[] }>('/api/account/cards')
      .then((response) => setCards(response.cards))
      .catch(() => setCards([]));
    void api<{ banks: { code: string; name: string }[] }>('/api/banks')
      .then((response) => setBanks(response.banks))
      .catch(() => setBanks([]));
    void refresh();
  }, [refresh]);

  useEffect(() => {
    writeKept(kept);
  }, [kept]);

  useEffect(() => {
    heading.current?.focus();
  }, [step]);

  useEffect(() => {
    if (step !== 'review') return;
    idempotencyKey.current = newKey();
  }, [step]);

  useEffect(() => {
    if (kept.method !== 'emi') return;
    void api<EmiPlansResponse>('/api/cart/emi-plans')
      .then(setPlans)
      .catch(() => setPlans(null));
  }, [kept.method, quote?.payable_paise]);

  if (quote === null) return <p className="muted">loading</p>;

  if (quote.lines.filter((line) => line.selected).length === 0) {
    return (
      <div className="panel panel-pink">
        <p className="shout">{COPY.emptyCart}</p>
      </div>
    );
  }

  const continueFromAddress = async (): Promise<void> => {
    if (kept.addressId === null) {
      setFieldErrors({ address: FIELD.badPincode });
      return;
    }
    const result = await run(() =>
      api<CartQuote>('/api/cart/destination', {
        method: 'PUT',
        body: { address_id: kept.addressId },
      }),
    );
    if (result === null) return;
    navigate(STEP_PATH.payment);
  };

  const continueFromPayment = async (): Promise<void> => {
    try {
      await api<CartQuote>('/api/cart/payment', {
        method: 'PUT',
        body: {
          method: kept.method,
          use_balance: kept.useBalance,
          emi_tenure_months: kept.method === 'emi' ? (kept.tenure ?? 3) : null,
        },
      });
      await refresh();
      setProblems('');
      navigate(STEP_PATH.review);
    } catch (error) {
      if (error instanceof ApiFailure) {
        setProblems(error.field('method') ?? error.body.message);
      }
    }
  };

  const payment = (): Record<string, unknown> => {
    const body: Record<string, unknown> = {
      method: kept.method,
      use_balance: kept.method === 'emi' ? false : kept.useBalance,
    };
    const [month, year] = card.expiry.split('/');
    const cardBody =
      kept.savedCardId !== null
        ? { saved_card_id: kept.savedCardId, cvv: card.cvv }
        : {
            number: card.number.replace(/\s/g, ''),
            expiry_month: Number(month ?? '0'),
            expiry_year: Number(`20${(year ?? '').slice(-2)}`),
            cvv: card.cvv,
            name: card.name,
            save: card.save,
          };
    if (kept.method === 'upi') body.upi = { vpa: kept.vpa };
    if (kept.method === 'netbanking') body.netbanking = { bank_code: kept.bank };
    if (kept.method === 'card') body.card = cardBody;
    if (kept.method === 'emi') {
      body.emi = { tenure_months: kept.tenure ?? 3, card: cardBody };
    }
    return body;
  };

  const pay = async (): Promise<void> => {
    setProblems('');
    try {
      const response = await api<CheckoutResponse>('/api/checkout', {
        method: 'POST',
        headers: { 'idempotency-key': idempotencyKey.current },
        body: {
          address_id: kept.addressId,
          expected_payable_paise: quote.payable_paise,
          payment: payment(),
        },
      });
      await refresh();
      navigate(response.confirmation_url);
    } catch (error) {
      if (error instanceof ApiFailure) {
        const first = error.body.errors === undefined ? null : Object.values(error.body.errors)[0];
        setProblems(first ?? error.body.message);
        if (error.body.error === 'price_changed') await refresh();
      }
    }
  };

  return (
    <>
      <NoiseBackdrop />
      <h1>checkout</h1>
      <div className="grid checkout-layout">
        <div>
          {step === 'address' ? (
            <section className="panel">
              <h2 ref={heading} tabIndex={-1}>
                address
              </h2>
              <fieldset role="radiogroup" aria-label="Delivery address" style={{ border: 0, padding: 0 }}>
                {addresses.map((address) => (
                  <div className="radio-row" key={address.id}>
                    <input
                      id={`address-${address.id}`}
                      type="radio"
                      name="address"
                      aria-label={`${address.label}, ${address.line1}, ${address.city} ${address.pincode}`}
                      checked={kept.addressId === address.id}
                      onChange={() => setKept({ ...kept, addressId: address.id })}
                    />
                    <label htmlFor={`address-${address.id}`}>
                      {`${address.label}: ${address.line1}, ${address.city} ${address.pincode}`}
                    </label>
                  </div>
                ))}
              </fieldset>
              <button type="button" className="btn btn-quiet" onClick={() => setNewAddressOpen(true)}>
                Add address
              </button>
              <PendingButton label="Continue" onPress={continueFromAddress} />
            </section>
          ) : null}

          {step === 'payment' ? (
            <section className="panel">
              <h2 ref={heading} tabIndex={-1}>
                payment
              </h2>
              <fieldset role="radiogroup" aria-label="Payment method" style={{ border: 0, padding: 0 }}>
                {METHOD_LABELS.map((method) => (
                  <div className="radio-row" key={method.value}>
                    <input
                      id={`method-${method.value}`}
                      type="radio"
                      name="method"
                      aria-label={method.label}
                      checked={kept.method === method.value}
                      onChange={() => setKept({ ...kept, method: method.value })}
                    />
                    <label htmlFor={`method-${method.value}`}>{method.label}</label>
                  </div>
                ))}
              </fieldset>
              {quote.cod.eligible ? null : (
                <p className="panel panel-pink">{quote.cod.message}</p>
              )}
              <div className="check-row">
                <input
                  id="use-balance"
                  type="checkbox"
                  aria-label="Use Chauraha balance"
                  checked={kept.useBalance}
                  disabled={kept.method === 'emi'}
                  onChange={() => setKept({ ...kept, useBalance: !kept.useBalance })}
                />
                <label htmlFor="use-balance">
                  {`Use Chauraha balance (${formatAmount(balancePaise)})`}
                </label>
              </div>

              {kept.method === 'upi' ? (
                <div>
                  <label htmlFor="upi-id">UPI ID</label>
                  <input
                    id="upi-id"
                    type="text"
                    aria-label="UPI ID"
                    value={kept.vpa}
                    onChange={(event) => setKept({ ...kept, vpa: event.target.value })}
                  />
                </div>
              ) : null}

              {kept.method === 'netbanking' ? (
                <div>
                  <label htmlFor="bank">Bank</label>
                  <select
                    id="bank"
                    aria-label="Bank"
                    value={kept.bank}
                    onChange={(event) => setKept({ ...kept, bank: event.target.value })}
                  >
                    <option value="">choose a bank</option>
                    {banks.map((bank) => (
                      <option key={bank.code} value={bank.code}>
                        {bank.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              {kept.method === 'card' || kept.method === 'emi' ? (
                <div>
                  {cards.length === 0 ? null : (
                    <fieldset role="radiogroup" aria-label="Saved cards" style={{ border: 0, padding: 0 }}>
                      {cards.map((saved) => (
                        <div className="radio-row" key={saved.card_id}>
                          <input
                            id={`card-${saved.card_id}`}
                            type="radio"
                            name="saved-card"
                            aria-label={`${saved.network} ending ${saved.last4}`}
                            checked={kept.savedCardId === saved.card_id}
                            onChange={() => setKept({ ...kept, savedCardId: saved.card_id })}
                          />
                          <label htmlFor={`card-${saved.card_id}`}>
                            {`${saved.network} ending ${saved.last4}`}
                          </label>
                        </div>
                      ))}
                      <div className="radio-row">
                        <input
                          id="card-new"
                          type="radio"
                          name="saved-card"
                          aria-label="A new card"
                          checked={kept.savedCardId === null}
                          onChange={() => setKept({ ...kept, savedCardId: null })}
                        />
                        <label htmlFor="card-new">a new card</label>
                      </div>
                    </fieldset>
                  )}
                  {kept.savedCardId === null ? (
                    <>
                      <label htmlFor="card-number">Card number</label>
                      <input
                        id="card-number"
                        type="text"
                        aria-label="Card number"
                        inputMode="numeric"
                        autoComplete="off"
                        value={card.number}
                        onChange={(event) => setCard({ ...card, number: event.target.value })}
                      />
                      <label htmlFor="card-expiry">Expiry (MM/YY)</label>
                      <input
                        id="card-expiry"
                        type="text"
                        aria-label="Expiry (MM/YY)"
                        value={card.expiry}
                        onChange={(event) => setCard({ ...card, expiry: event.target.value })}
                      />
                      <label htmlFor="card-name">Name on card</label>
                      <input
                        id="card-name"
                        type="text"
                        aria-label="Name on card"
                        value={card.name}
                        onChange={(event) => setCard({ ...card, name: event.target.value })}
                      />
                      <div className="check-row">
                        <input
                          id="card-save"
                          type="checkbox"
                          aria-label="Save this card"
                          checked={card.save}
                          onChange={() => setCard({ ...card, save: !card.save })}
                        />
                        <label htmlFor="card-save">Save this card</label>
                      </div>
                    </>
                  ) : null}
                  <label htmlFor="card-cvv">CVV</label>
                  <input
                    id="card-cvv"
                    type="password"
                    aria-label="CVV"
                    inputMode="numeric"
                    autoComplete="off"
                    value={card.cvv}
                    onChange={(event) => setCard({ ...card, cvv: event.target.value })}
                  />
                </div>
              ) : null}

              {kept.method === 'emi' ? (
                <fieldset role="radiogroup" aria-label="EMI tenure" style={{ border: 0, padding: 0 }}>
                  {(plans?.plans ?? []).map((plan) => (
                    <div className="radio-row" key={plan.tenure_months}>
                      <input
                        id={`tenure-${plan.tenure_months}`}
                        type="radio"
                        name="tenure"
                        aria-label={`${plan.tenure_months} months`}
                        checked={(kept.tenure ?? 3) === plan.tenure_months}
                        onChange={() => setKept({ ...kept, tenure: plan.tenure_months })}
                      />
                      <label htmlFor={`tenure-${plan.tenure_months}`}>
                        {`${plan.tenure_months} months · ${formatAmount(plan.instalment_paise)} each · interest ${formatAmount(plan.total_interest_paise)}`}
                      </label>
                    </div>
                  ))}
                </fieldset>
              ) : null}

              <PendingButton label="Continue" onPress={continueFromPayment} />
            </section>
          ) : null}

          {step === 'review' ? (
            <section className="panel">
              <h2 ref={heading} tabIndex={-1}>
                review
              </h2>
              <ul className="plain">
                {quote.parcels.map((parcel) => (
                  <li key={parcel.seller_id} className="panel panel-black">
                    <h4>{parcel.seller_name}</h4>
                    <p>
                      {parcel.promise_date === null
                        ? ''
                        : `arrives by ${formatPromiseDate(parcel.promise_date)}`}
                    </p>
                    <p>
                      delivery <Amount paise={parcel.delivery_fee_paise} />
                    </p>
                  </li>
                ))}
              </ul>
              {kept.method === 'cod' ? (
                <PendingButton label="Place order" onPress={pay} />
              ) : (
                <PendingButton label={`Pay ${formatAmount(quote.payable_paise)}`} onPress={pay} />
              )}
              <StatusRegion name="Checkout problems" message={problems} alert />
            </section>
          ) : null}
        </div>

        <aside className="panel panel-black">
          <h3>order summary</h3>
          <div className="bill-line">
            <span>subtotal</span>
            <span>
              <Amount paise={quote.subtotal_paise} />
            </span>
          </div>
          <div className="bill-line">
            <span>coupon</span>
            <span>
              <Amount paise={-quote.discount_paise} />
            </span>
          </div>
          <div className="bill-line">
            <span>delivery</span>
            <span>
              <Amount paise={quote.delivery_paise} />
            </span>
          </div>
          <div className="bill-line">
            <span>cash on delivery fee</span>
            <span>
              <Amount paise={quote.cod_fee_paise} />
            </span>
          </div>
          <div className="bill-line">
            <span>chauraha balance</span>
            <span>
              <Amount paise={-quote.balance_applied_paise} />
            </span>
          </div>
          <div className="bill-line">
            <span>due</span>
            <span>
              <Amount paise={quote.due_paise} />
            </span>
          </div>
          {desktop ? (
            <span role="group" aria-label="Payable total" className="price">
              <Reel paise={quote.payable_paise} />
            </span>
          ) : null}
        </aside>
      </div>

      {desktop ? null : (
        <div className="cart-strip">
          <span role="group" aria-label="Payable total" className="price">
            <Reel paise={quote.payable_paise} />
          </span>
        </div>
      )}

      <Dialog name="New address" open={newAddressOpen} onClose={() => setNewAddressOpen(false)}>
        {Object.entries({
          label: 'Label',
          name: 'Name',
          line1: 'Address line 1',
          line2: 'Address line 2',
          city: 'City',
          pincode: 'Pincode',
          phone: 'Phone',
        }).map(([field, label]) => (
          <div key={field}>
            <label htmlFor={`draft-${field}`}>{label}</label>
            <input
              id={`draft-${field}`}
              type="text"
              aria-label={label}
              value={draft[field as keyof typeof draft]}
              onChange={(event) => setDraft({ ...draft, [field]: event.target.value })}
            />
            {fieldErrors[field] === undefined ? null : (
              <p className="panel panel-pink">{fieldErrors[field]}</p>
            )}
          </div>
        ))}
        <PendingButton
          label="Save address"
          onPress={async () => {
            try {
              const created = await api<Address>('/api/account/addresses', {
                method: 'POST',
                body: draft,
              });
              setAddresses((previous) => [...previous, created]);
              setKept({ ...kept, addressId: created.id });
              setFieldErrors({});
              setNewAddressOpen(false);
            } catch (error) {
              if (error instanceof ApiFailure) setFieldErrors(error.body.errors ?? {});
            }
          }}
        />
      </Dialog>
    </>
  );
}
