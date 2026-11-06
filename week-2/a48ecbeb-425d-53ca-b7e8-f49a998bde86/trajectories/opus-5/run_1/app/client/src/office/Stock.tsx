import { useEffect, useState, type ReactElement } from 'react';
import { flavourName } from '../../../shared/catalogue.js';
import { api, type StockRow } from '../api.js';

export function Stock(): ReactElement {
  const [rows, setRows] = useState<StockRow[]>([]);

  useEffect(() => {
    const read = () =>
      void api
        .get<{ flavours: StockRow[] }>('/api/staff/stock')
        .then((payload) => setRows(payload.flavours))
        .catch(() => setRows([]));
    read();
    const timer = window.setInterval(read, 5_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="office__content">
      <h1>Stock</h1>
      <table className="office__table mono" aria-label="Stock">
        <thead>
          <tr>
            <th scope="col">Flavour</th>
            <th scope="col">Received</th>
            <th scope="col">Sold</th>
            <th scope="col">Returned</th>
            <th scope="col">On hand</th>
            <th scope="col">Reserved</th>
            <th scope="col">Available</th>
            <th scope="col">Released</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.flavour}>
              <th scope="row">{flavourName(row.flavour)}</th>
              <td>{row.received}</td>
              <td>{row.sold}</td>
              <td>{row.returned}</td>
              <td>{row.on_hand}</td>
              <td>{row.reserved}</td>
              <td>{row.available}</td>
              <td>{row.released === null ? '—' : row.released}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
