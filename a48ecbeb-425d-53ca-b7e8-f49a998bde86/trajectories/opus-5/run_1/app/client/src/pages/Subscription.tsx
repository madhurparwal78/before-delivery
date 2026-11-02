import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { PLANS } from '../../../shared/catalogue.js';
import { subscriptionCopy } from '../../../shared/copy.js';
import { formatLongDate } from '../../../shared/time.js';
import { ApiCallError, api, type ChangePayload, type SubscriptionPayload } from '../api.js';
import { Link, useRouter } from '../router.js';
import { useShop } from '../state/shop.js';
import { NotFound } from './NotFound.js';
import { dunningBannerText, subscriptionStateText } from './subscriptionText.js';

type ChangeBody =
  | { kind: 'pause'; cycles: number }
  | { kind: 'resume' }
  | { kind: 'skip' }
  | { kind: 'swap'; plan: string }
  | { kind: 'cancel' };

function useSubscription(id: string) {
  const [subscription, setSubscription] = useState<SubscriptionPayload | null>(null);
  const [missing, setMissing] = useState(false);
  const [outage, setOutage] = useState(false);

  const load = useCallback(async () => {
    try {
      const payload = await api.get<{ subscription: SubscriptionPayload }>(
        `/api/subscriptions/${id}`,
      );
      setSubscription(payload.subscription);
      setOutage(false);
      return payload.subscription;
    } catch (error) {
      if (error instanceof ApiCallError && error.status === 404) setMissing(true);
      if (error instanceof ApiCallError && error.failure.error === 'billing_unavailable') {
        setOutage(true);
      }
      return null;
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  return { subscription, missing, outage, load, setSubscription };
}

/** The status message a change's badge carries. */
function statusMessage(change: ChangePayload | null): string {
  if (change === null) return '';
  if (change.status === 'pending_provider') return subscriptionCopy.pending;
  if (change.status === 'applied') return subscriptionCopy.applied;
  return subscriptionCopy.rejected;
}

export function Subscription({ id }: { id: string }): ReactElement {
  const { userLoaded, user } = useShop();
  const { navigate, search } = useRouter();
  const { subscription, missing, outage, load } = useSubscription(id);
  const [message, setMessage] = useState('');

  const cardMessage = new URLSearchParams(search).get('card');

  useEffect(() => {
    if (!userLoaded) return;
    if (user === null) navigate(`/sign-in?next=/account/subscriptions/${id}`, { replace: true });
  }, [id, navigate, user, userLoaded]);

  const pending = subscription?.pending_change ?? null;

  /** While a change is pending the page checks its status every 2 seconds. */
  useEffect(() => {
    if (pending === null) return;
    const timer = window.setInterval(() => {
      void load();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [load, pending]);

  const act = async (body: ChangeBody) => {
    setMessage('');
    try {
      await api.post<{ change: ChangePayload }>(`/api/subscriptions/${id}/changes`, body);
      await load();
      setMessage(subscriptionCopy.pending);
    } catch (error) {
      if (!(error instanceof ApiCallError)) throw error;
      if (error.failure.error === 'change_pending') setMessage(subscriptionCopy.alreadyPending);
      else if (error.failure.error === 'illegal_change') setMessage(subscriptionCopy.notPossible);
      else if (error.failure.error === 'billing_unavailable') {
        setMessage(subscriptionCopy.billingOutage);
      } else setMessage(error.failure.message);
    }
  };

  if (missing) return <NotFound />;

  if (outage) {
    return (
      <div className="page paper narrow">
        <h1>Your auto-delivery</h1>
        <p role="status" aria-live="polite" aria-label="Subscription status" className="live-region">
          {subscriptionCopy.billingOutage}
        </p>
      </div>
    );
  }

  if (subscription === null) return <div className="page paper narrow" />;

  const banner = dunningBannerText(subscription);
  const latest = subscription.pending_change ?? subscription.last_change;
  const disabled = pending !== null;
  const status =
    message !== ''
      ? message
      : cardMessage === 'saved'
        ? subscriptionCopy.cardSaved
        : cardMessage === 'recovered'
          ? subscriptionCopy.cardSavedAndPaid
          : statusMessage(latest);

  return (
    <div className="page paper narrow subscription">
      <h1>Your auto-delivery</h1>

      {banner === null ? null : (
        <p role="alert" className="notice notice--warn">
          {banner}
        </p>
      )}

      <p className="subscription__state">
        <strong>{subscriptionStateText(subscription)}</strong> &middot; {subscription.plan_label}
      </p>
      {subscription.state === 'cancelled' && subscription.dunning !== null ? (
        <p>{subscriptionCopy.dunningCancelled}</p>
      ) : null}

      <dl className="subscription__facts">
        <dt>Delivery rhythm</dt>
        <dd>{subscription.cadence === 'monthly' ? 'Every month' : 'Every two months'}</dd>
        <dt>Next renewal</dt>
        <dd className="mono">
          {subscription.next_renewal_date === null
            ? '—'
            : formatLongDate(subscription.next_renewal_date)}
        </dd>
        <dt>Card</dt>
        <dd className="mono">
          {subscription.card.brand} ending {subscription.card.last4}
        </dd>
      </dl>

      {subscription.changes_apply_to === null ? null : (
        <p className="subscription__cutoff">
          {subscription.changes_apply_to === subscription.next_renewal_date
            ? `Changes made now apply to your next box, on ${formatLongDate(subscription.changes_apply_to)}.`
            : subscriptionCopy.cutoff(formatLongDate(subscription.changes_apply_to))}
        </p>
      )}

      {latest === null || cardMessage !== null ? null : (
        <p className="badge badge--change">
          {latest.status === 'pending_provider'
            ? subscriptionCopy.badge.pending_provider
            : latest.status === 'applied'
              ? subscriptionCopy.badge.applied
              : subscriptionCopy.badge.rejected}
        </p>
      )}

      <div className="subscription__actions">
        <Link
          to={`/account/subscriptions/${id}/pause`}
          className="button button--quiet"
          aria-disabled={disabled}
        >
          Pause deliveries
        </Link>
        <button
          type="button"
          className="button button--quiet"
          disabled={disabled}
          onClick={() => void act({ kind: 'resume' })}
        >
          Resume deliveries
        </button>
        <button
          type="button"
          className="button button--quiet"
          disabled={disabled}
          onClick={() => void act({ kind: 'skip' })}
        >
          Skip next box
        </button>
        <Link
          to={`/account/subscriptions/${id}/swap`}
          className="button button--quiet"
          aria-disabled={disabled}
        >
          Swap flavours
        </Link>
        <Link
          to={`/account/subscriptions/${id}/cancel`}
          className="button button--quiet"
          aria-disabled={disabled}
        >
          Cancel subscription
        </Link>
        <Link to={`/account/subscriptions/${id}/card`} className="button button--quiet">
          Update card
        </Link>
      </div>

      <p role="status" aria-live="polite" aria-label="Subscription status" className="live-region">
        {status}
      </p>
    </div>
  );
}

function ChangePage({
  id,
  title,
  children,
  onSave,
  saveLabel,
}: {
  id: string;
  title: string;
  children: ReactElement;
  onSave: () => Promise<void>;
  saveLabel: string;
}): ReactElement {
  const [message, setMessage] = useState('');
  return (
    <div className="page paper narrow">
      <h1>{title}</h1>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void onSave().catch((error: unknown) => {
            if (error instanceof ApiCallError) setMessage(error.failure.message);
          });
        }}
      >
        {children}
        <button type="submit" className="button button--primary">
          {saveLabel}
        </button>
      </form>
      <p role="status" aria-live="polite" aria-label="Subscription status" className="live-region">
        {message}
      </p>
      <Link to={`/account/subscriptions/${id}`}>Back to your auto-delivery</Link>
    </div>
  );
}

export function PauseSubscription({ id }: { id: string }): ReactElement {
  const { navigate } = useRouter();
  const [cycles, setCycles] = useState(1);
  return (
    <ChangePage
      id={id}
      title="Pause deliveries"
      saveLabel="Save pause"
      onSave={async () => {
        await api.post(`/api/subscriptions/${id}/changes`, { kind: 'pause', cycles });
        navigate(`/account/subscriptions/${id}`);
      }}
    >
      <fieldset className="radiogroup">
        <legend>Pause for</legend>
        {[1, 2, 3].map((count) => (
          <label key={count}>
            <input
              type="radio"
              name="cycles"
              value={count}
              checked={cycles === count}
              onChange={() => setCycles(count)}
            />
            {count === 1 ? '1 box' : `${count} boxes`}
          </label>
        ))}
      </fieldset>
    </ChangePage>
  );
}

export function SwapSubscription({ id }: { id: string }): ReactElement {
  const { navigate } = useRouter();
  const { subscription } = useSubscription(id);
  const [plan, setPlan] = useState('');
  const cadence = subscription?.cadence;
  const choices = PLANS.filter((candidate) => candidate.cadence === cadence);

  return (
    <ChangePage
      id={id}
      title="Swap flavours"
      saveLabel="Save swap"
      onSave={async () => {
        await api.post(`/api/subscriptions/${id}/changes`, { kind: 'swap', plan });
        navigate(`/account/subscriptions/${id}`);
      }}
    >
      <fieldset className="radiogroup radiogroup--stacked">
        <legend>Choose your box</legend>
        {choices.map((candidate) => (
          <label key={candidate.name}>
            <input
              type="radio"
              name="plan"
              value={candidate.name}
              checked={plan === candidate.name}
              onChange={() => setPlan(candidate.name)}
            />
            {candidate.label}
          </label>
        ))}
      </fieldset>
    </ChangePage>
  );
}

export function CancelSubscription({ id }: { id: string }): ReactElement {
  const { navigate } = useRouter();
  const { subscription } = useSubscription(id);
  return (
    <ChangePage
      id={id}
      title="Cancel subscription"
      saveLabel="Cancel at end of term"
      onSave={async () => {
        await api.post(`/api/subscriptions/${id}/changes`, { kind: 'cancel' });
        navigate(`/account/subscriptions/${id}`);
      }}
    >
      <p>
        Your boxes carry on until{' '}
        <span className="mono">
          {subscription?.next_renewal_date === null || subscription === null
            ? 'the end of the term'
            : formatLongDate(subscription.next_renewal_date)}
        </span>
        . Nothing more is charged after that.
      </p>
    </ChangePage>
  );
}

export function UpdateCard({ id }: { id: string }): ReactElement {
  const { navigate } = useRouter();
  const [cardNumber, setCardNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvc, setCvc] = useState('');
  const [message, setMessage] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const save = async () => {
    setMessage('');
    setErrors({});
    const [month, year] = expiry.split('/').map((part) => part.trim());
    try {
      const before = await api.get<{ subscription: SubscriptionPayload }>(
        `/api/subscriptions/${id}`,
      );
      await api.put(`/api/subscriptions/${id}/card`, {
        number: cardNumber.replace(/\s+/g, ''),
        expiry_month: Number(month),
        expiry_year: year === undefined ? 0 : 2000 + Number(year),
        cvc,
      });
      navigate(
        `/account/subscriptions/${id}?card=${
          before.subscription.state === 'past_due' ? 'recovered' : 'saved'
        }`,
      );
    } catch (error) {
      if (!(error instanceof ApiCallError)) throw error;
      if (error.status === 402) setMessage(subscriptionCopy.cardDeclined);
      else if (error.failure.error === 'billing_unavailable') {
        setMessage(subscriptionCopy.billingOutage);
      } else if (error.failure.fields !== undefined) setErrors(error.failure.fields);
      else setMessage(error.failure.message);
    }
  };

  return (
    <div className="page paper narrow">
      <h1>Update card</h1>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="field">
          <label htmlFor="card-number">Card number</label>
          <input
            id="card-number"
            className="mono"
            value={cardNumber}
            onChange={(event) => setCardNumber(event.target.value)}
          />
          {errors.card_number === undefined ? null : (
            <p className="field__error">{errors.card_number}</p>
          )}
        </div>
        <div className="field">
          <label htmlFor="card-expiry">Expiry (MM/YY)</label>
          <input
            id="card-expiry"
            className="mono"
            placeholder="MM/YY"
            value={expiry}
            onChange={(event) => setExpiry(event.target.value)}
          />
          {errors.card_expiry === undefined ? null : (
            <p className="field__error">{errors.card_expiry}</p>
          )}
        </div>
        <div className="field">
          <label htmlFor="card-cvc">Security code</label>
          <input
            id="card-cvc"
            className="mono"
            value={cvc}
            onChange={(event) => setCvc(event.target.value)}
          />
          {errors.card_cvc === undefined ? null : <p className="field__error">{errors.card_cvc}</p>}
        </div>
        <button type="submit" className="button button--primary">
          Save card
        </button>
      </form>
      <p role="status" aria-live="polite" aria-label="Subscription status" className="live-region">
        {message}
      </p>
      <Link to={`/account/subscriptions/${id}`}>Back to your auto-delivery</Link>
    </div>
  );
}
