import { useEffect, useState, type ReactElement } from 'react';
import { provinceName } from '../../../shared/catalogue.js';
import { apiMessages, subscriptionCopy } from '../../../shared/copy.js';
import { formatDollars } from '../../../shared/money.js';
import { formatLongDate } from '../../../shared/time.js';
import {
  ApiCallError,
  api,
  type AddressPayload,
  type OrderPayload,
  type SubscriptionPayload,
} from '../api.js';
import { Link, useRouter } from '../router.js';
import { useShop } from '../state/shop.js';
import { subscriptionStateText } from './subscriptionText.js';

export function Account(): ReactElement {
  const { user, userLoaded, setUser } = useShop();
  const { navigate } = useRouter();
  const [orders, setOrders] = useState<OrderPayload[]>([]);
  const [subscriptions, setSubscriptions] = useState<SubscriptionPayload[]>([]);
  const [addresses, setAddresses] = useState<AddressPayload[]>([]);
  const [outage, setOutage] = useState('');

  useEffect(() => {
    if (!userLoaded) return;
    if (user === null) {
      navigate('/sign-in?next=/account', { replace: true });
      return;
    }
    void api
      .get<{ orders: OrderPayload[] }>('/api/orders')
      .then((payload) => setOrders(payload.orders))
      .catch((error: unknown) => {
        if (error instanceof ApiCallError && error.failure.error === 'store_unavailable') {
          setOutage(apiMessages.storeUnavailable);
        }
      });
    void api
      .get<{ subscriptions: SubscriptionPayload[] }>('/api/subscriptions')
      .then((payload) => setSubscriptions(payload.subscriptions))
      .catch((error: unknown) => {
        if (error instanceof ApiCallError && error.failure.error === 'billing_unavailable') {
          setOutage(subscriptionCopy.billingOutage);
        }
      });
    void api
      .get<{ addresses: AddressPayload[] }>('/api/addresses')
      .then((payload) => setAddresses(payload.addresses))
      .catch(() => setAddresses([]));
  }, [navigate, user, userLoaded]);

  return (
    <div className="page paper account">
      <h1>Your account</h1>
      {outage === '' ? null : <p className="notice notice--warn">{outage}</p>}

      <section>
        <h2>Orders</h2>
        {orders.length === 0 ? (
          <p>No orders yet.</p>
        ) : (
          <ul className="account__orders">
            {orders.map((order) => (
              <li key={order.number}>
                <Link to={order.thank_you_url} className="mono">
                  {order.number}
                </Link>
                <span>{formatLongDate(order.placed_at.slice(0, 10))}</span>
                <span className="mono">{formatDollars(order.total_cents)}</span>
                <span>{order.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>Subscriptions</h2>
        {subscriptions.length === 0 ? (
          <p>No auto-delivery yet. Build a crate of 12 and turn subscribe-and-save on.</p>
        ) : (
          <ul className="account__subscriptions">
            {subscriptions.map((subscription) => (
              <li key={subscription.id}>
                <Link to={`/account/subscriptions/${subscription.id}`}>
                  {subscription.plan_label}
                </Link>
                <span>{subscriptionStateText(subscription)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>Saved addresses</h2>
        <ul className="account__addresses">
          {addresses.map((address) => (
            <li key={address.id}>
              {address.name}, {address.line1}, {address.city}, {provinceName(address.province)}{' '}
              <span className="mono">{address.postal_code}</span>
              {address.is_default ? <span className="badge">Default</span> : null}
            </li>
          ))}
        </ul>
      </section>

      <button
        type="button"
        className="button button--quiet"
        onClick={() => {
          void api.post('/api/auth/sign-out').then(() => {
            setUser(null);
            navigate('/');
          });
        }}
      >
        Sign out
      </button>
    </div>
  );
}
