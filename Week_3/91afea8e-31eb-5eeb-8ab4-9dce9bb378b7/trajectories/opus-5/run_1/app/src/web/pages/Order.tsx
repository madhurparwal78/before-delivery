/** One order across its shipments: invoices, cancels, returns and the exact refund. */

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api, ApiFailure } from '../api.ts';
import { Amount, Dialog, PendingButton, StatusRegion } from '../components/ui.tsx';
import { formatAmount, formatPromiseDate } from '../../shared/format.js';
import { errorMessage, refundConfirmed, refundPending, returnRequested } from '../../shared/messages.js';
import type { OrderDetail, ShopperShipmentView } from '../../shared/types.js';

function methodLabel(method: string, last4: string | null): string {
  switch (method) {
    case 'upi':
      return 'UPI';
    case 'card':
      return last4 === null ? 'card' : `card ending ${last4}`;
    case 'netbanking':
      return 'net banking';
    case 'emi':
      return 'card EMI';
    default:
      return 'Chauraha balance';
  }
}

export function OrderPage({ orderId }: { orderId: string }): ReactNode {
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [message, setMessage] = useState('');
  const [returnFor, setReturnFor] = useState<{
    shipment: ShopperShipmentView;
    lineId: string;
    title: string;
    max: number;
  } | null>(null);
  const [cancelFor, setCancelFor] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [reason, setReason] = useState('');
  const [dialogMessage, setDialogMessage] = useState('');

  const load = async (): Promise<void> => {
    const detail = await api<OrderDetail>(`/api/orders/${orderId}`);
    setOrder(detail);
  };

  useEffect(() => {
    void load().catch(() => setOrder(null));
  }, [orderId]);

  if (order === null) return <p className="muted">loading</p>;

  const legs = order.payment?.legs ?? [];
  /** Refunds go to the other method first and the balance last, so that leg carries the label. */
  const refundLeg = legs.find((leg) => leg.method !== 'balance') ?? legs[0];

  return (
    <>
      <h1>{`order ${order.order_id}`}</h1>
      <section className="panel panel-black">
        <h3>payment</h3>
        <ul className="plain">
          {legs.map((leg, index) => (
            <li key={`${leg.method}-${index}`} className="bill-line">
              <span>{methodLabel(leg.method, leg.card_last4 ?? null)}</span>
              <span>
                <Amount paise={leg.amount_paise} />
              </span>
            </li>
          ))}
        </ul>
      </section>

      <ul className="plain grid grid-2 grid-3">
        {order.shipments.map((shipment) => (
          <li key={shipment.shipment_id}>
            <section
              className="panel"
              role="region"
              aria-label={`Shipment ${shipment.shipment_id}`}
            >
              <h4>{shipment.seller_name}</h4>
              <p className="chip">{shipment.state}</p>
              <p>{`arrives by ${formatPromiseDate(shipment.promise_date)}`}</p>
              <ol className="timeline">
                {shipment.timeline.map((entry, index) => (
                  <li key={`${entry.state}-${index}`}>{`${entry.state} ${entry.at.slice(0, 10)}`}</li>
                ))}
              </ol>
              {shipment.invoice_status === 'ready' ? (
                <a
                  className="btn btn-quiet"
                  href={`/api/shipments/${shipment.shipment_id}/invoice`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Download invoice
                </a>
              ) : (
                <p className="panel panel-pink">{errorMessage('document_pending')}</p>
              )}
              <ul className="plain">
                {shipment.lines.map((line) => (
                  <li key={line.line_id} className="panel panel-black">
                    <p>{`${line.title} × ${line.quantity}`}</p>
                    <div className="bill-line">
                      <span>line total</span>
                      <span>
                        <Amount paise={line.line_total_paise} />
                      </span>
                    </div>
                    <div className="bill-line">
                      <span>taxable value</span>
                      <span>
                        <Amount paise={line.taxable_value_paise} />
                      </span>
                    </div>
                    {line.igst_paise > 0 ? (
                      <div className="bill-line">
                        <span>{`igst ${line.gst_rate}%`}</span>
                        <span>
                          <Amount paise={line.igst_paise} />
                        </span>
                      </div>
                    ) : (
                      <>
                        <div className="bill-line">
                          <span>{`cgst ${line.gst_rate / 2}%`}</span>
                          <span>
                            <Amount paise={line.cgst_paise} />
                          </span>
                        </div>
                        <div className="bill-line">
                          <span>{`sgst ${line.gst_rate / 2}%`}</span>
                          <span>
                            <Amount paise={line.sgst_paise} />
                          </span>
                        </div>
                      </>
                    )}
                    {line.refunded_paise > 0 ? (
                      <p>
                        {refundConfirmed(
                          formatAmount(line.refunded_paise),
                          methodLabel(refundLeg?.method ?? 'balance', refundLeg?.card_last4 ?? null),
                        )}
                      </p>
                    ) : null}
                    {line.refund_pending_paise > 0 ? (
                      <p>{refundPending(formatAmount(line.refund_pending_paise))}</p>
                    ) : null}
                    {shipment.state === 'delivered' ? (
                      <button
                        type="button"
                        className="btn btn-quiet"
                        onClick={() => {
                          setReturnFor({
                            shipment,
                            lineId: line.line_id,
                            title: line.title,
                            max: line.quantity,
                          });
                          setQuantity(1);
                          setReason('');
                          setDialogMessage('');
                        }}
                      >
                        {`Return ${line.title}`}
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
              {shipment.state === 'placed' || shipment.state === 'packed' ? (
                <button
                  type="button"
                  className="btn btn-pink"
                  onClick={() => setCancelFor(shipment.shipment_id)}
                >
                  Cancel shipment
                </button>
              ) : null}
            </section>
          </li>
        ))}
      </ul>
      <StatusRegion name="Order updates" message={message} />

      <Dialog
        name="Return item"
        open={returnFor !== null}
        onClose={() => setReturnFor(null)}
      >
        <label htmlFor="return-quantity">Quantity to return</label>
        <input
          id="return-quantity"
          type="number"
          role="spinbutton"
          aria-label="Quantity to return"
          min={1}
          max={returnFor?.max ?? 1}
          value={quantity}
          onChange={(event) => setQuantity(Number(event.target.value))}
        />
        <label htmlFor="return-reason">Reason</label>
        <textarea
          id="return-reason"
          aria-label="Reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
        {dialogMessage === '' ? null : <p className="panel panel-pink">{dialogMessage}</p>}
        <PendingButton
          label="Request return"
          onPress={async () => {
            if (returnFor === null) return;
            try {
              const created = await api<{ refund_estimate_paise: number }>('/api/returns', {
                method: 'POST',
                body: {
                  shipment_line_id: returnFor.lineId,
                  quantity,
                  reason,
                },
              });
              setMessage(returnRequested(formatAmount(created.refund_estimate_paise)));
              setReturnFor(null);
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

      <Dialog
        name="Cancel shipment"
        open={cancelFor !== null}
        onClose={() => setCancelFor(null)}
      >
        <p>this cancels the whole parcel and refunds its prepaid share.</p>
        <PendingButton
          label="Cancel shipment"
          className="btn btn-pink"
          onPress={async () => {
            if (cancelFor === null) return;
            try {
              await api(`/api/shipments/${cancelFor}/cancel`, { method: 'POST', body: {} });
              setCancelFor(null);
              await load();
            } catch (error) {
              if (error instanceof ApiFailure) setMessage(error.body.message);
            }
          }}
        />
      </Dialog>
    </>
  );
}
