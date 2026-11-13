/** Support: one order lookup, the two views side by side, a line refund and a reopen. */

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api, ApiFailure } from '../api.ts';
import { useRouter } from '../router.tsx';
import {
  Amount,
  Dialog,
  PendingButton,
  StatusRegion,
  useDesktop,
} from '../components/ui.tsx';
import { formatPromiseDate } from '../../shared/format.js';
import type { SupportOrderView } from '../../shared/types.js';

export function SupportPage(): ReactNode {
  const { navigate } = useRouter();
  const [orderId, setOrderId] = useState('');
  const [message, setMessage] = useState('');

  return (
    <>
      <h1>support</h1>
      <section className="panel">
        <label htmlFor="order-id">Order ID</label>
        <input
          id="order-id"
          type="text"
          role="searchbox"
          aria-label="Order ID"
          value={orderId}
          onChange={(event) => setOrderId(event.target.value)}
        />
        <PendingButton
          label="Find order"
          onPress={async () => {
            try {
              await api<SupportOrderView>(`/api/support/orders/${orderId}`);
              navigate(`/support/orders/${orderId}`);
            } catch (error) {
              if (error instanceof ApiFailure) setMessage(error.body.message);
            }
          }}
        />
        <StatusRegion name="Order updates" message={message} />
      </section>
    </>
  );
}

export function SupportOrderPage({ orderId }: { orderId: string }): ReactNode {
  const desktop = useDesktop();
  const [order, setOrder] = useState<SupportOrderView | null>(null);
  const [tab, setTab] = useState<'shopper' | 'seller'>('shopper');
  const [message, setMessage] = useState('');
  const [refundFor, setRefundFor] = useState<{ lineId: string; title: string } | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [reason, setReason] = useState('');
  const [dialogMessage, setDialogMessage] = useState('');

  const load = async (): Promise<void> => {
    setOrder(await api<SupportOrderView>(`/api/support/orders/${orderId}`));
  };

  useEffect(() => {
    void load().catch(() => setOrder(null));
  }, [orderId]);

  if (order === null) return <p className="muted">loading</p>;

  const shopperPanel = (
    <section className="panel" aria-label="Shopper view">
      <h3>shopper view</h3>
      {order.shipments.map((shipment) => (
        <div key={shipment.shipment_id} className="panel panel-black">
          <h4>{`${shipment.seller_name} · ${shipment.state}`}</h4>
          <p>{`arrives by ${formatPromiseDate(shipment.shopper_view.promise_date)}`}</p>
          <ul className="plain">
            {shipment.shopper_view.lines.map((line) => (
              <li key={line.line_id}>
                <p>{`${line.title} × ${line.quantity}`}</p>
                <div className="bill-line">
                  <span>line total</span>
                  <span>
                    <Amount paise={line.line_total_paise} />
                  </span>
                </div>
                <div className="bill-line">
                  <span>refunded</span>
                  <span>
                    <Amount paise={line.refunded_paise} />
                  </span>
                </div>
                <button
                  type="button"
                  className="btn btn-quiet"
                  onClick={() => {
                    setRefundFor({ lineId: line.line_id, title: line.title });
                    setQuantity(1);
                    setReason('');
                    setDialogMessage('');
                  }}
                >
                  {`Refund ${line.title}`}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );

  const sellerPanel = (
    <section className="panel" aria-label="Seller view">
      <h3>seller view</h3>
      {order.shipments.map((shipment) => (
        <div key={shipment.shipment_id} className="panel panel-black">
          <h4>{`${shipment.seller_name} · ${shipment.seller_view.state}`}</h4>
          <p>{`${shipment.seller_view.payment_kind} · ${shipment.seller_view.payment_status}`}</p>
          <p>{`${shipment.seller_view.ship_to.name} · ${shipment.seller_view.ship_to.city} ${shipment.seller_view.ship_to.pincode}`}</p>
          <ul className="plain">
            {shipment.seller_view.lines.map((line) => (
              <li key={line.line_id}>
                {`${line.title} × ${line.quantity} · `}
                <Amount paise={line.gross_paise} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );

  return (
    <>
      <h1>{`order ${order.order_id}`}</h1>
      <section className="panel panel-yellow">
        <p>{`${order.shopper.name} · ${order.shopper.phone_masked}`}</p>
        <ul className="plain">
          {order.payment.legs.map((leg, index) => (
            <li key={`${leg.method}-${index}`} className="bill-line">
              <span>
                {leg.card_last4 === null ? leg.method : `${leg.method} ending ${leg.card_last4}`}
              </span>
              <span>
                <Amount paise={leg.amount_paise} />
              </span>
            </li>
          ))}
        </ul>
      </section>

      {desktop ? (
        <div className="grid grid-2">
          {shopperPanel}
          {sellerPanel}
        </div>
      ) : (
        <>
          <div className="row" role="tablist" aria-label="Views">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'shopper'}
              className="btn btn-quiet"
              onClick={() => setTab('shopper')}
            >
              Shopper view
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'seller'}
              className="btn btn-quiet"
              onClick={() => setTab('seller')}
            >
              Seller view
            </button>
          </div>
          {tab === 'shopper' ? shopperPanel : sellerPanel}
        </>
      )}

      <section className="panel">
        <h3>returns</h3>
        <ul className="plain">
          {order.returns.map((entry) => (
            <li key={entry.return_id}>
              {`${entry.return_id} · ${entry.state} · ${entry.quantity} unit(s)`}
              {entry.state === 'declined' ? (
                <PendingButton
                  label="Reopen return"
                  onPress={async () => {
                    try {
                      await api(`/api/support/returns/${entry.return_id}/reopen`, {
                        method: 'POST',
                        body: { note: 'Reopened by support desk' },
                      });
                      await load();
                    } catch (error) {
                      if (error instanceof ApiFailure) setMessage(error.body.message);
                    }
                  }}
                />
              ) : null}
            </li>
          ))}
        </ul>
        <StatusRegion name="Order updates" message={message} />
      </section>

      <Dialog name="Refund line" open={refundFor !== null} onClose={() => setRefundFor(null)}>
        <label htmlFor="refund-quantity">Quantity</label>
        <input
          id="refund-quantity"
          type="number"
          role="spinbutton"
          aria-label="Quantity"
          min={1}
          value={quantity}
          onChange={(event) => setQuantity(Number(event.target.value))}
        />
        <label htmlFor="refund-reason">Reason</label>
        <textarea
          id="refund-reason"
          aria-label="Reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
        {dialogMessage === '' ? null : <p className="panel panel-pink">{dialogMessage}</p>}
        <PendingButton
          label="Refund line"
          onPress={async () => {
            if (refundFor === null) return;
            try {
              await api(`/api/support/shipment-lines/${refundFor.lineId}/refunds`, {
                method: 'POST',
                body: { quantity, reason },
              });
              setRefundFor(null);
              await load();
            } catch (error) {
              if (error instanceof ApiFailure) {
                setDialogMessage(
                  error.body.errors === undefined
                    ? error.body.message
                    : (Object.values(error.body.errors)[0] ?? error.body.message),
                );
              }
            }
          }}
        />
      </Dialog>
    </>
  );
}
