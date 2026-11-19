import { useCallback, useState, type ReactNode } from 'react';
import type { OwnerOrder } from '../../../shared/api';
import { formatMoney } from '../../../shared/money';
import { api } from '../../lib/api';
import { useLiveUpdates } from '../../lib/live';
import { OwnerFrame } from './OwnerFrame';

export function OwnerOrders(): ReactNode {
  const [orders, setOrders] = useState<OwnerOrder[]>([]);
  const load = useCallback(async () => {
    const result = await api.ownerOrders();
    if (result.data !== undefined) setOrders(result.data.orders);
    return result.status;
  }, []);

  useLiveUpdates({ owner: true }, () => {
    void load();
  });

  return (
    <OwnerFrame load={load}>
      <h1>Orders</h1>
      <div className="table-frame">
        <table aria-label="Orders">
          <thead>
            <tr>
              <th scope="col">Order</th>
              <th scope="col">Performance</th>
              <th scope="col">Status</th>
              <th scope="col">Total</th>
              <th scope="col">Net paid</th>
              <th scope="col">Kill Bill payments</th>
              <th scope="col">Receipt</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id}>
                <th scope="row" className="figures">
                  {order.id}
                </th>
                <td>{order.performanceTitle}</td>
                <td>{order.status}</td>
                <td className="figures">{formatMoney(order.totalCents)}</td>
                <td className="figures">{formatMoney(order.netPaidCents)}</td>
                <td className="figures">{order.killbillPaymentIds.join(' ')}</td>
                <td>{order.receipt ?? 'none'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </OwnerFrame>
  );
}
