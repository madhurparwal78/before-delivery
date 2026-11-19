import { useState, type JSX } from 'react';
import { api } from '../api';
import { useLiveResource } from '../live';
import { AlertBanner, InlineAlert, Pill, useAnnounce } from '../ui';
import { dateDdMonYyyy, money } from '../time';
import { SplitBand, useApp } from '../app';
import { messageOf } from './today';

type Batch = { batch: string; expiresOn: string; remaining: number; expired: boolean };

type Item = {
  id: string;
  name: string;
  onHand: number;
  usable: number;
  reorderPoint: number;
  unitPricePence: number;
  low: boolean;
  batches: Batch[];
};

type Movement = {
  id: string;
  delta: number;
  reason: string;
  reasonLabel: string;
  batch: string;
  balanceAfter: number;
  byName: string | null;
  at: string;
};

export function StockScreen(): JSX.Element {
  const { session } = useApp();
  const announce = useAnnounce();
  const stock = useLiveResource<{ items: Item[] }>('/api/stock', ['stock']);
  const [openItem, setOpenItem] = useState<string | null>(null);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [alert, setAlert] = useState<string | null>(null);
  const [formItem, setFormItem] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [reason, setReason] = useState<'Received' | 'Expired'>('Received');
  const [batch, setBatch] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const items = stock.data?.items ?? [];
  const lowCount = items.filter((item) => item.low).length;
  const isManager = session?.role === 'manager';
  const chosen = items.find((item) => item.id === (formItem || items[0]?.id));

  const openMovements = async (item: Item): Promise<void> => {
    if (openItem === item.id) {
      setOpenItem(null);
      return;
    }
    const data = await api<{ movements: Movement[] }>('GET', `/api/stock/${item.id}/movements`);
    setMovements(data.movements);
    setOpenItem(item.id);
  };

  const record = async (): Promise<void> => {
    const itemId = formItem || items[0]?.id;
    const count = Number(quantity);
    if (!itemId || !Number.isInteger(count) || count < 1) {
      setFormError('Quantity is not valid.');
      return;
    }
    if (!batch.trim()) {
      setFormError('Batch is required.');
      return;
    }
    setBusy(true);
    try {
      await api('POST', `/api/stock/${itemId}/movements`, {
        delta: reason === 'Received' ? count : -count,
        reason: reason === 'Received' ? 'receive' : 'expired',
        batch: batch.trim(),
        ...(reason === 'Received' ? { expiresOn } : {}),
      });
      const item = items.find((candidate) => candidate.id === itemId);
      announce(
        `Recorded ${reason === 'Received' ? '+' : '-'}${count} for ${item?.name ?? ''}.`,
      );
      setFormError(null);
      setAlert(null);
      stock.reload();
      if (openItem === itemId) {
        const data = await api<{ movements: Movement[] }>('GET', `/api/stock/${itemId}/movements`);
        setMovements(data.movements);
      }
    } catch (error) {
      setFormError(messageOf(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen">
      <SplitBand
        headline={<h1>Stock</h1>}
        right={
          <p className="band-count" role="status" aria-label="Low stock count" data-value={lowCount}>
            {`${lowCount} low`}
          </p>
        }
      />
      <div className="screen-body">
        <AlertBanner message={alert} />
        <table className="data-table" aria-label="Stock">
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col">On hand</th>
              <th scope="col">Usable</th>
              <th scope="col">Reorder point</th>
              <th scope="col">Unit price</th>
              <th scope="col">Movements</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <>
                <tr key={item.id} aria-label={`${item.name}, ${item.onHand} on hand`}>
                  <td>
                    {item.name}
                    {item.low ? <span className="chip chip-late">Low stock</span> : null}
                  </td>
                  <td>{item.onHand}</td>
                  <td>{`Usable ${item.usable}`}</td>
                  <td>{item.reorderPoint}</td>
                  <td>{money(item.unitPricePence)}</td>
                  <td>
                    <Pill
                      variant="secondary"
                      name={`Movements, ${item.name}`}
                      onClick={() => void openMovements(item)}
                    >
                      Movements
                    </Pill>
                  </td>
                </tr>
                {openItem === item.id ? (
                  <tr key={`${item.id}-detail`}>
                    <td colSpan={6}>
                      <ul className="batch-list" aria-label="Batches">
                        {item.batches.map((entry) => (
                          <li
                            key={entry.batch}
                            aria-label={`${entry.batch}, ${entry.remaining} left, expires ${dateDdMonYyyy(
                              entry.expiresOn,
                            )}`}
                          >
                            {`${entry.batch}, ${entry.remaining} left, expires ${dateDdMonYyyy(
                              entry.expiresOn,
                            )}`}
                            {entry.expired ? <span className="chip">Expired</span> : null}
                          </li>
                        ))}
                      </ul>
                      <ul className="movement-list" aria-label="Movements">
                        {movements.map((movement) => {
                          const signed =
                            movement.delta >= 0 ? `+${movement.delta}` : `-${Math.abs(movement.delta)}`;
                          const label = `${signed}, ${movement.reasonLabel}, batch ${movement.batch}, balance ${movement.balanceAfter}`;
                          return (
                            <li key={movement.id} aria-label={label}>
                              {label}
                              {movement.byName ? <span className="chip">{movement.byName}</span> : null}
                            </li>
                          );
                        })}
                      </ul>
                    </td>
                  </tr>
                ) : null}
              </>
            ))}
          </tbody>
        </table>

        {isManager ? (
          <div className="form-row stock-form">
            <div className="field">
              <label htmlFor="movement-item">Item</label>
              <select
                id="movement-item"
                value={formItem || items[0]?.id || ''}
                onChange={(event) => setFormItem(event.target.value)}
              >
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="movement-quantity">Quantity</label>
              <input
                id="movement-quantity"
                type="number"
                min={1}
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="movement-reason">Reason</label>
              <select
                id="movement-reason"
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value as 'Received' | 'Expired');
                  setBatch('');
                }}
              >
                <option value="Received">Received</option>
                <option value="Expired">Expired</option>
              </select>
            </div>
            {reason === 'Received' ? (
              <>
                <div className="field">
                  <label htmlFor="movement-batch">Batch</label>
                  <input
                    id="movement-batch"
                    type="text"
                    value={batch}
                    onChange={(event) => setBatch(event.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="movement-expires">Expires on</label>
                  <input
                    id="movement-expires"
                    type="date"
                    value={expiresOn}
                    onChange={(event) => setExpiresOn(event.target.value)}
                  />
                </div>
              </>
            ) : (
              <div className="field">
                <label htmlFor="movement-batch-choice">Batch</label>
                <select
                  id="movement-batch-choice"
                  value={batch}
                  onChange={(event) => setBatch(event.target.value)}
                >
                  <option value="">Choose a batch</option>
                  {(chosen?.batches ?? []).map((entry) => (
                    <option key={entry.batch} value={entry.batch}>
                      {entry.batch}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <Pill busy={busy} onClick={() => void record()}>
              Record movement
            </Pill>
            <InlineAlert message={formError} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
