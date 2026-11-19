import { useState, type FormEvent } from 'react';
import { can, STOCK_REASON_LABEL } from '../../../shared/domain';
import { dueLabel } from '../../../shared/clinictime';
import { announce, announceFromServer } from '../lib/announce';
import { errorText, mutate, post } from '../lib/api';
import { useMe } from '../lib/env';
import { signed } from '../lib/format';
import { useLive } from '../lib/live';
import { useResource } from '../lib/resource';
import type { Movement, StockItem } from '../lib/types';
import { SplitBand } from '../components/Shell';
import { Banner, Chip, EmptyCard, Field, Pill, Skeleton } from '../components/ui';

function ItemDetail({ item }: { item: StockItem }) {
  const movements = useResource<{ movements: Movement[] }>(`/api/stock/${item.id}/movements`, ['stock']);
  return (
    <div className="stock-detail">
      <div>
        <h3 className="card-title">{`Batches, ${item.name}`}</h3>
        <ul aria-label="Batches" className="plain-list">
          {item.batches.map((b) => (
            <li key={b.batch} aria-label={`${b.batch}, ${b.remaining} left, expires ${dueLabel(b.expiresOn)}`}>
              {`${b.batch}, ${b.remaining} left, expires ${dueLabel(b.expiresOn)}`} {b.expired && <Chip tone="rose">Expired</Chip>}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="card-title">Movements</h3>
        <ul aria-label="Movements" className="plain-list">
          {movements.data?.movements.map((m) => {
            const text = `${signed(m.delta)}, ${STOCK_REASON_LABEL[m.reason]}, batch ${m.batch}, balance ${m.balanceAfter}`;
            return (
              <li key={m.id} aria-label={text}>
                {text}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function MovementForm({ items }: { items: StockItem[] }) {
  const [itemId, setItemId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState<'receive' | 'expired'>('receive');
  const [batch, setBatch] = useState('');
  const [expires, setExpires] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const item = items.find((i) => i.id === itemId);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const count = Number(quantity);
    try {
      await mutate(
        () =>
          post(`/api/stock/${itemId}/movements`, {
            delta: quantity === '' ? undefined : reason === 'receive' ? count : -count,
            reason,
            batch,
            ...(reason === 'receive' ? { expiresOn: expires } : {}),
          }),
        () => announce(`Recorded ${signed(reason === 'receive' ? count : -count)} for ${item?.name}.`),
      );
      setQuantity('');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="movement-form tint-plain" onSubmit={(e) => void submit(e)} noValidate>
      <h2 className="section-title">Record a movement</h2>
      <div className="form-row">
        <Field id="move-item" label="Item">
          <select id="move-item" value={itemId} onChange={(e) => setItemId(e.target.value)}>
            <option value="">Choose an item</option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </Field>
        <Field id="move-quantity" label="Quantity">
          <input id="move-quantity" type="number" min={1} step={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </Field>
        <Field id="move-reason" label="Reason">
          <select
            id="move-reason"
            value={reason}
            onChange={(e) => {
              setReason(e.target.value as 'receive' | 'expired');
              setBatch('');
            }}
          >
            <option value="receive">Received</option>
            <option value="expired">Expired</option>
          </select>
        </Field>
        {reason === 'receive' ? (
          <>
            <Field id="move-batch" label="Batch">
              <input id="move-batch" type="text" value={batch} onChange={(e) => setBatch(e.target.value)} />
            </Field>
            <Field id="move-expires" label="Expires on">
              <input id="move-expires" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
            </Field>
          </>
        ) : (
          <Field id="move-batch-pick" label="Batch">
            <select id="move-batch-pick" value={batch} onChange={(e) => setBatch(e.target.value)}>
              <option value="">Choose a batch</option>
              {item?.batches.map((b) => (
                <option key={b.batch} value={b.batch}>
                  {b.batch}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>
      <Banner message={error} />
      <Pill type="submit" busy={busy}>
        Record movement
      </Pill>
    </form>
  );
}

export function Stock() {
  const me = useMe();
  const stock = useResource<{ items: StockItem[] }>('/api/stock', ['stock']);
  const [open, setOpen] = useState<string | null>(null);
  useLive(['low'], (event) => {
    if (event.t === 'low' && can(me.role, 'stock.write')) announceFromServer(`${event.item} is low: ${event.usable} left.`);
  });
  const items = stock.data?.items;
  const lowCount = items?.filter((i) => i.low).length ?? 0;
  return (
    <>
      <SplitBand title="Stock">
        <div className="low-count">
          <span role="status" aria-label="Low stock count" aria-live="off" data-value={lowCount} className="band-number">
            {lowCount}
          </span>
          <span> items at or below their reorder point</span>
        </div>
      </SplitBand>
      {!items ? (
        <Skeleton rows={4} />
      ) : items.length === 0 ? (
        <EmptyCard title="No stock items yet." tone="sky" />
      ) : (
        <table aria-label="Stock" className="data-table" role="table">
          <thead role="rowgroup">
            <tr role="row">
              <th role="columnheader">Item</th>
              <th role="columnheader" className="num">
                On hand
              </th>
              <th role="columnheader" className="num">
                Usable
              </th>
              <th role="columnheader" className="num">
                Reorder point
              </th>
              <th role="columnheader" className="num">
                Unit price
              </th>
              <th role="columnheader" />
            </tr>
          </thead>
          <tbody role="rowgroup">
            {items.flatMap((i) => {
              const price = `£${Math.trunc(i.unitPricePence / 100)}.${String(i.unitPricePence % 100).padStart(2, '0')}`;
              return [
                <tr key={i.id} role="row" aria-label={`${i.name}, ${i.onHand} on hand`}>
                  <td role="cell" data-label="Item">
                    {i.name} {i.low && <Chip tone="rose">Low stock</Chip>}
                  </td>
                  <td role="cell" className="num" data-label="On hand">
                    {i.onHand}
                  </td>
                  <td role="cell" className="num" data-label="Usable">{`Usable ${i.usable}`}</td>
                  <td role="cell" className="num" data-label="Reorder point">
                    {i.reorderPoint}
                  </td>
                  <td role="cell" className="num" data-label="Unit price">
                    {price}
                  </td>
                  <td role="cell">
                    <Pill variant="outline" className="on-light" aria-expanded={open === i.id} aria-label={`Movements, ${i.name}`} onClick={() => setOpen(open === i.id ? null : i.id)}>
                      Movements
                    </Pill>
                  </td>
                </tr>,
                open === i.id && (
                  <tr key={`${i.id}-detail`} role="row">
                    <td role="cell" colSpan={6}>
                      <ItemDetail item={i} />
                    </td>
                  </tr>
                ),
              ];
            })}
          </tbody>
        </table>
      )}
      {items && can(me.role, 'stock.write') && <MovementForm items={items} />}
    </>
  );
}
