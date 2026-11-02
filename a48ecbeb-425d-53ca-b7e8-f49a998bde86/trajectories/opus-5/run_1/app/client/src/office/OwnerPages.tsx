import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { PROVINCES, flavourName } from '../../../shared/catalogue.js';
import { SERVICE_LABELS, SERVICE_ORDER, settingsCopy } from '../../../shared/copy.js';
import { formatCents, formatDollars, parseDollarsToCents } from '../../../shared/money.js';
import { formatLongDate } from '../../../shared/time.js';
import {
  ApiCallError,
  api,
  type ApplicationPayload,
  type OrderPayload,
  type OwnerSettings,
  type PendingReview,
  type ServiceStatuses,
  type SubscriptionPayload,
} from '../api.js';
import { Link } from '../router.js';
import { subscriptionStateText } from '../pages/subscriptionText.js';

export function Search(): ReactElement {
  const [term, setTerm] = useState('');
  const [orders, setOrders] = useState<OrderPayload[]>([]);
  const [subscriptions, setSubscriptions] = useState<SubscriptionPayload[]>([]);
  const [searched, setSearched] = useState(false);

  const run = async () => {
    const payload = await api.get<{
      orders: OrderPayload[];
      subscriptions: SubscriptionPayload[];
    }>(`/api/staff/search?q=${encodeURIComponent(term)}`);
    setOrders(payload.orders);
    setSubscriptions(payload.subscriptions);
    setSearched(true);
  };

  return (
    <div className="office__content">
      <h1>Find an order or subscription</h1>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void run();
        }}
      >
        <div className="field">
          <label htmlFor="office-search">Find an order or subscription</label>
          <input
            id="office-search"
            type="search"
            value={term}
            placeholder="CB-100001 or name@example.test"
            onChange={(event) => setTerm(event.target.value)}
          />
        </div>
        <button type="submit" className="button button--primary">
          Search
        </button>
      </form>

      {searched ? (
        <>
          <h2>Orders</h2>
          {orders.length === 0 ? (
            <p>No orders matched.</p>
          ) : (
            <ul className="office__results">
              {orders.map((order) => (
                <li key={order.number}>
                  <Link to={`/office/orders/${order.number}`} className="mono">
                    {order.number}
                  </Link>
                  <span className="mono">{formatDollars(order.total_cents)}</span>
                  <span>{order.status}</span>
                </li>
              ))}
            </ul>
          )}

          <h2>Subscriptions</h2>
          {subscriptions.length === 0 ? (
            <p>No subscriptions matched.</p>
          ) : (
            <ul className="office__results">
              {subscriptions.map((subscription) => (
                <li key={subscription.id}>
                  <span className="mono">{subscription.id}</span>
                  <span>{subscription.plan_label}</span>
                  <span>{subscriptionStateText(subscription)}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </div>
  );
}

export function Dashboard(): ReactElement {
  const [dashboard, setDashboard] = useState<{
    dunning: { entered: number; recovered: number; cancelled: number; in_progress: number };
    refunds: { count: number; total_cents: number };
    services: ServiceStatuses;
  } | null>(null);

  useEffect(() => {
    const read = () =>
      void api
        .get<NonNullable<typeof dashboard>>('/api/owner/dashboard')
        .then(setDashboard)
        .catch(() => setDashboard(null));
    read();
    const timer = window.setInterval(read, 10_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="office__content">
      <h1>Dashboard</h1>
      <div className="office__grid">
        <section aria-label="Dunning recovery" className="office__panel">
          <h2>Dunning recovery</h2>
          <dl className="mono">
            <dt>Entered</dt>
            <dd>{dashboard?.dunning.entered ?? 0}</dd>
            <dt>Recovered</dt>
            <dd>{dashboard?.dunning.recovered ?? 0}</dd>
            <dt>Cancelled</dt>
            <dd>{dashboard?.dunning.cancelled ?? 0}</dd>
            <dt>In progress</dt>
            <dd>{dashboard?.dunning.in_progress ?? 0}</dd>
          </dl>
          <p>Last 30 days.</p>
        </section>

        <section aria-label="Refunds" className="office__panel">
          <h2>Refunds</h2>
          <dl className="mono">
            <dt>Count</dt>
            <dd>{dashboard?.refunds.count ?? 0}</dd>
            <dt>Total</dt>
            <dd>{formatDollars(dashboard?.refunds.total_cents ?? 0)}</dd>
          </dl>
          <p>Last 30 days.</p>
        </section>

        <section className="office__panel">
          <h2>Services</h2>
          <ul aria-label="Services" className="office__services mono">
            {SERVICE_ORDER.map((service) => (
              <li key={service}>
                {SERVICE_LABELS[service]}: {dashboard?.services[service] === 'down' ? 'Down' : 'Up'}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

export function Settings(): ReactElement {
  const [settings, setSettings] = useState<OwnerSettings | null>(null);
  const [shipping, setShipping] = useState<Record<string, string>>({});
  const [thresholds, setThresholds] = useState<Record<string, string>>({});
  const [dropPrice, setDropPrice] = useState('');
  const [released, setReleased] = useState('');
  const [status, setStatus] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const payload = await api.get<OwnerSettings>('/api/owner/settings');
    setSettings(payload);
    setShipping(
      Object.fromEntries(
        payload.provinces.map((province) => [province.code, formatCents(province.shipping_cents)]),
      ),
    );
    setThresholds(
      Object.fromEntries(
        payload.provinces.map((province) => [
          province.code,
          formatCents(province.free_shipping_threshold_cents),
        ]),
      ),
    );
    setDropPrice(formatCents(payload.drop.can_price_cents));
    setReleased(String(payload.drop.released));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setStatus('');
    setErrors({});
    try {
      for (const province of PROVINCES) {
        const shippingCents = parseDollarsToCents(shipping[province.code] ?? '');
        const thresholdCents = parseDollarsToCents(thresholds[province.code] ?? '');
        if (shippingCents === null || thresholdCents === null) {
          setErrors({ [province.code]: 'Enter dollars with two decimals, like 14.95.' });
          return;
        }
        await api.put(`/api/owner/provinces/${province.code}`, {
          shipping_cents: shippingCents,
          free_shipping_threshold_cents: thresholdCents,
        });
      }
      const priceCents = parseDollarsToCents(dropPrice);
      if (priceCents === null) {
        setErrors({ drop_price: 'Enter dollars with two decimals, like 3.75.' });
        return;
      }
      await api.put('/api/owner/drop', {
        can_price_cents: priceCents,
        released: Number(released),
      });
      await load();
      setStatus(settingsCopy.success);
    } catch (error) {
      if (!(error instanceof ApiCallError)) throw error;
      if (error.failure.error === 'below_committed') {
        setStatus(settingsCopy.belowCommitted(error.failure.committed ?? 0));
      } else if (error.failure.fields !== undefined) setErrors(error.failure.fields);
      else setStatus(error.failure.message);
    }
  };

  return (
    <div className="office__content">
      <h1>Settings</h1>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {(settings?.provinces ?? []).map((province) => (
          <fieldset key={province.code} className="office__fieldset">
            <legend>{province.name}</legend>
            <div className="field">
              <label htmlFor={`shipping-${province.code}`}>{province.name} shipping</label>
              <input
                id={`shipping-${province.code}`}
                className="mono"
                value={shipping[province.code] ?? ''}
                onChange={(event) =>
                  setShipping((current) => ({ ...current, [province.code]: event.target.value }))
                }
              />
            </div>
            <div className="field">
              <label htmlFor={`threshold-${province.code}`}>
                {province.name} free-shipping threshold
              </label>
              <input
                id={`threshold-${province.code}`}
                className="mono"
                value={thresholds[province.code] ?? ''}
                onChange={(event) =>
                  setThresholds((current) => ({ ...current, [province.code]: event.target.value }))
                }
              />
            </div>
            {errors[province.code] === undefined ? null : (
              <p className="field__error">{errors[province.code]}</p>
            )}
          </fieldset>
        ))}

        <fieldset className="office__fieldset">
          <legend>Cacao Orange</legend>
          <div className="field">
            <label htmlFor="drop-price">Cacao Orange price</label>
            <input
              id="drop-price"
              className="mono"
              value={dropPrice}
              onChange={(event) => setDropPrice(event.target.value)}
            />
            {errors.drop_price === undefined ? null : (
              <p className="field__error">{errors.drop_price}</p>
            )}
          </div>
          <div className="field">
            <label htmlFor="drop-released">Cacao Orange released</label>
            <input
              id="drop-released"
              type="number"
              min={0}
              step={1}
              className="mono"
              value={released}
              onChange={(event) => setReleased(event.target.value)}
            />
            {errors.released === undefined ? null : (
              <p className="field__error">{errors.released}</p>
            )}
          </div>
        </fieldset>

        <button type="submit" className="button button--primary">
          Save settings
        </button>
      </form>
      <p role="status" aria-live="polite" aria-label="Settings status" className="live-region">
        {status}
      </p>
    </div>
  );
}

export function Applications(): ReactElement {
  const [applications, setApplications] = useState<ApplicationPayload[]>([]);
  const [status, setStatus] = useState('');

  const load = useCallback(async () => {
    const payload = await api.get<{ applications: ApplicationPayload[] }>(
      '/api/owner/applications',
    );
    setApplications(payload.applications);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (id: string, decision: 'approved' | 'declined') => {
    setStatus('');
    try {
      await api.post(`/api/owner/applications/${id}/decision`, { decision });
      await load();
      setStatus(`Application ${decision}.`);
    } catch (error) {
      if (error instanceof ApiCallError) setStatus(error.failure.message);
    }
  };

  return (
    <div className="office__content">
      <h1>Retailer applications</h1>
      {applications.length === 0 ? <p>No applications yet.</p> : null}
      <ul className="office__results">
        {applications.map((application) => (
          <li key={application.id}>
            <span>{application.business_name}</span>
            <span className="mono">{application.email}</span>
            <span>{application.province}</span>
            <span>{application.status}</span>
            <a
              className="button button--quiet"
              href={`/api/owner/applications/${application.id}/licence`}
            >
              View licence
            </a>
            {application.status === 'submitted' ? (
              <>
                <button
                  type="button"
                  className="button button--primary"
                  onClick={() => void decide(application.id, 'approved')}
                >
                  Approve
                </button>
                <button
                  type="button"
                  className="button button--quiet"
                  onClick={() => void decide(application.id, 'declined')}
                >
                  Decline
                </button>
              </>
            ) : null}
          </li>
        ))}
      </ul>
      <p role="status" aria-live="polite" className="live-region">
        {status}
      </p>
    </div>
  );
}

export function Reviews(): ReactElement {
  const [reviews, setReviews] = useState<PendingReview[]>([]);
  const [status, setStatus] = useState('');

  const load = useCallback(async () => {
    const payload = await api.get<{ reviews: PendingReview[] }>(
      '/api/owner/reviews?status=pending',
    );
    setReviews(payload.reviews);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (id: string, decision: 'approved' | 'rejected') => {
    setStatus('');
    try {
      await api.post(`/api/owner/reviews/${id}/decision`, { decision });
      await load();
      setStatus(`Review ${decision}.`);
    } catch (error) {
      if (error instanceof ApiCallError) setStatus(error.failure.message);
    }
  };

  return (
    <div className="office__content">
      <h1>Reviews waiting for a decision</h1>
      {reviews.length === 0 ? <p>No reviews waiting.</p> : null}
      <ul className="office__results">
        {reviews.map((review) => (
          <li key={review.id}>
            <span>{flavourName(review.flavour)}</span>
            <span className="mono">{review.rating} / 5</span>
            <span>{review.body}</span>
            <span>{review.author_first_name}</span>
            <span className="mono">{formatLongDate(review.created_at.slice(0, 10))}</span>
            <button
              type="button"
              className="button button--primary"
              onClick={() => void decide(review.id, 'approved')}
            >
              Approve review
            </button>
            <button
              type="button"
              className="button button--quiet"
              onClick={() => void decide(review.id, 'rejected')}
            >
              Reject review
            </button>
          </li>
        ))}
      </ul>
      <p role="status" aria-live="polite" className="live-region">
        {status}
      </p>
    </div>
  );
}
