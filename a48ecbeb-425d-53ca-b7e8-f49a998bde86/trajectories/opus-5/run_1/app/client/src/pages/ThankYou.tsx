import { useEffect, useState, type ReactElement } from 'react';
import { checkoutCopy } from '../../../shared/copy.js';
import { formatDollars } from '../../../shared/money.js';
import { flavourName } from '../../../shared/catalogue.js';
import { taxLineLabel } from '../../../shared/quote.js';
import { api, type OrderPayload } from '../api.js';
import { Link } from '../router.js';
import { useShop } from '../state/shop.js';
import { NotFound } from './NotFound.js';

export function ThankYou({ orderNumber }: { orderNumber: string }): ReactElement {
  const { user, userLoaded } = useShop();
  const [order, setOrder] = useState<OrderPayload | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!userLoaded) return;
    void api
      .get<{ order: OrderPayload }>(`/api/orders/${orderNumber}`)
      .then((payload) => setOrder(payload.order))
      .catch(() => setMissing(true));
  }, [orderNumber, userLoaded]);

  if (missing || (userLoaded && user === null)) return <NotFound />;
  if (order === null) return <div className="page paper" />;

  return (
    <div className="page paper thanks">
      <h1>Order {order.number} is confirmed</h1>
      <p className="thanks__receipt">{checkoutCopy.receiptLine(user?.email ?? '')}</p>

      <h2>Your cans</h2>
      <ul className="thanks__lines">
        {order.lines.map((line) => (
          <li key={line.flavour}>
            <span>
              {line.quantity} x {flavourName(line.flavour)}
            </span>
            <span className="mono">{formatDollars(line.goods_cents)}</span>
          </li>
        ))}
      </ul>

      <h2>Totals</h2>
      <table className="breakdown mono" aria-label="Price breakdown">
        <tbody>
          <tr>
            <th scope="row">Subtotal</th>
            <td>{formatDollars(order.goods_cents)}</td>
          </tr>
          {order.discount_cents > 0 ? (
            <tr>
              <th scope="row">Subscribe &amp; save (10%)</th>
              <td>{formatDollars(-order.discount_cents)}</td>
            </tr>
          ) : null}
          <tr>
            <th scope="row">Deposit</th>
            <td>{formatDollars(order.deposit_cents)}</td>
          </tr>
          <tr>
            <th scope="row">Shipping</th>
            <td>{order.shipping_cents === 0 ? 'Free' : formatDollars(order.shipping_cents)}</td>
          </tr>
          {order.taxes.map((tax) => (
            <tr key={tax.name}>
              <th scope="row">{taxLineLabel(tax.name, tax.rate)}</th>
              <td>{formatDollars(tax.cents)}</td>
            </tr>
          ))}
          <tr className="breakdown__total">
            <th scope="row">Total</th>
            <td>{formatDollars(order.total_cents)}</td>
          </tr>
        </tbody>
      </table>

      <div className="thanks__actions">
        <a className="button button--primary" href={order.invoice_url}>
          Download invoice (PDF)
        </a>
        {order.subscription_id === null ? null : (
          <Link
            className="button button--quiet"
            to={`/account/subscriptions/${order.subscription_id}`}
          >
            Manage your subscription
          </Link>
        )}
      </div>
    </div>
  );
}
