import { useMemo, useState } from 'react';
import { api, ApiError, LostReplyError, newIdempotencyKey } from '../lib/api.js';
import { useCatalog } from '../lib/hooks.js';
import { useLockedCurrency } from '../lib/account.js';
import { useStore } from '../lib/store.js';
import { ConfirmationHeading, ErrorSummary } from '../components/Dialog.js';
import {
  copy,
  donationNotice,
  planPriceLine,
  scheduledChangeLine,
  TIER_NAMES,
} from '../../shared/copy.js';
import { CURRENCIES, formatPrice, parseAmountToMinor, type Currency } from '../../shared/money.js';
import { formatDayKey } from '../../shared/lisbon.js';
import type { Order } from '../../shared/types.js';

interface DonationResponse {
  order: Order;
  receipt_email: 'sent' | 'delayed';
}

function DonateForm(): JSX.Element {
  const { announce, setServiceNotice } = useStore();
  const catalog = useCatalog();
  const locked = useLockedCurrency();
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<Currency>(locked ?? 'EUR');
  const [card, setCard] = useState('');
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [done, setDone] = useState<DonationResponse | null>(null);

  /* One key per set of field values, reused until a value changes. */
  const signature = `${amount}|${currency}|${card}|${note}`;
  const key = useMemo(() => newIdempotencyKey(), [signature]);

  async function submit(): Promise<void> {
    const amountMinor = parseAmountToMinor(amount, currency);
    if (amountMinor === null) {
      setMessage(null);
      setFields({ amount_minor: copy.amountFormat });
      return;
    }
    setPending(true);
    setMessage(null);
    setFields({});
    announce(copy.paymentPending);
    try {
      const result = await api<DonationResponse>('/api/donations', {
        method: 'POST',
        body: { amount_minor: amountMinor, currency, card_number: card, note },
        idempotencyKey: key,
      });
      setDone(result);
      announce(donationNotice(result.order.amount_minor, result.order.currency));
      if (result.receipt_email === 'delayed') setServiceNotice(copy.receiptEmailDelayed);
    } catch (error) {
      if (error instanceof ApiError) {
        setMessage(error.message);
        setFields(error.fields);
        if (error.code === 'billing_unavailable' || error.code === 'storage_unavailable') {
          setServiceNotice(error.message);
        }
      } else if (error instanceof LostReplyError) {
        setMessage(copy.donationLostReply);
      }
      announce('');
    }
    setPending(false);
  }

  if (done) {
    return (
      <section>
        <ConfirmationHeading>{copy.donationSuccessHeading}</ConfirmationHeading>
        <p>{donationNotice(done.order.amount_minor, done.order.currency)}</p>
        <p>{`Receipt ${done.order.receipt_number}`}</p>
      </section>
    );
  }

  const limits = catalog.data?.donation;

  return (
    <form
      aria-label="Donate"
      onSubmit={(event) => {
        event.preventDefault();
        if (!pending) void submit();
      }}
    >
      <h2>Make a donation</h2>
      <ErrorSummary
        message={message}
        fields={fields}
        fieldIds={{ amount_minor: 'donate-amount', card_number: 'donate-card', note: 'donate-note' }}
      />
      <div className="field">
        <label htmlFor="donate-amount">Amount</label>
        <input
          id="donate-amount"
          type="text"
          inputMode="decimal"
          aria-label="Amount"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
        {fields.amount_minor ? <span className="field-error">{fields.amount_minor}</span> : null}
        {limits ? (
          <span className="secondary">
            {`${formatPrice(limits.min_minor[currency], currency)} to ${formatPrice(limits.max_minor[currency], currency)}`}
          </span>
        ) : null}
      </div>
      <fieldset className="field" style={{ border: 0, margin: 0, padding: 0 }}>
        <legend className="catalogue">Currency</legend>
        <div className="radio-row" role="radiogroup" aria-label="Currency">
          {CURRENCIES.map((entry) => (
            <label key={entry}>
              <input
                type="radio"
                name="donate-currency"
                aria-label={entry}
                checked={currency === entry}
                disabled={locked !== null && locked !== entry}
                onChange={() => setCurrency(entry)}
              />
              {entry}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="field">
        <label htmlFor="donate-card">Card number</label>
        <input
          id="donate-card"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          aria-label="Card number"
          value={card}
          onChange={(event) => setCard(event.target.value)}
        />
        {fields.card_number ? <span className="field-error">{fields.card_number}</span> : null}
      </div>
      <div className="field">
        <label htmlFor="donate-note">Note to the curators</label>
        <textarea
          id="donate-note"
          aria-label="Note to the curators"
          rows={3}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
        {fields.note ? <span className="field-error">{fields.note}</span> : null}
      </div>
      <div className="inline-actions">
        <button type="submit" disabled={pending}>
          Donate
        </button>
      </div>
    </form>
  );
}

export function Support({ onOpenPlan }: { onOpenPlan: () => void }): JSX.Element {
  const catalog = useCatalog();

  return (
    <>
      <h1>Support the reading room</h1>
      <p>
        Supporters keep the eight rooms open, the scans coming and the guided sessions free to schools. Every tier is
        billed monthly, in your own currency.
      </p>
      {catalog.error ? <p className="secondary">{copy.pricesUnavailable}</p> : null}
      <div className="tier-grid">
        {(catalog.data?.tiers ?? []).map((tier) => (
          <section key={tier.tier} className="museum-card">
            <span className="catalogue">{`HRR-${tier.name}`}</span>
            <h2 style={{ fontSize: 'var(--step-2)' }}>{TIER_NAMES[tier.tier]}</h2>
            <p className="readout">{planPriceLine(tier.prices.EUR, 'EUR')}</p>
            {CURRENCIES.filter((entry) => entry !== 'EUR').map((entry) => (
              <p key={entry} className="secondary figure">
                {planPriceLine(tier.prices[entry], entry)}
              </p>
            ))}
            {tier.scheduled_changes.map((change) => (
              <p key={`${change.currency}-${change.effective_on}`} className="secondary">
                {scheduledChangeLine(formatDayKey(change.effective_on), change.amount_minor, change.currency)}
              </p>
            ))}
          </section>
        ))}
      </div>
      <div className="inline-actions">
        <button type="button" onClick={onOpenPlan}>
          Choose a plan
        </button>
      </div>
      <DonateForm />
    </>
  );
}
