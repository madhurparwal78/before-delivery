import { FLAVOUR_NAMES } from "../../shared/format";
import { Loading, PageFailure, useOfficeData } from "./shared";

// The stock ledger's figures per flavour, refreshed every 5 seconds.

const STOCK_POLL_MS = 5000;

interface StockFigures {
  flavour: string;
  received: number;
  sold: number;
  returned: number;
  on_hand: number;
  reserved: number;
  available: number;
  released: number | null;
}

const COLUMNS: [keyof Omit<StockFigures, "flavour" | "released">, string][] = [
  ["received", "Received"],
  ["sold", "Sold"],
  ["returned", "Returned"],
  ["on_hand", "On hand"],
  ["reserved", "Reserved"],
  ["available", "Available"],
];

export function Stock() {
  const { data, failure } = useOfficeData<{ flavours: StockFigures[] }>("/api/staff/stock", STOCK_POLL_MS);
  return (
    <div className="office-page">
      <h1>Stock</h1>
      {failure && !data && <PageFailure failure={failure} />}
      {!data && !failure && <Loading />}
      {data && (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Stock figures">
          <table aria-label="Stock" className="office-table stock-table">
            <thead>
              <tr>
                <th scope="col">Flavour</th>
                {COLUMNS.map(([key, label]) => (
                  <th scope="col" key={key} className="figure">
                    {label}
                  </th>
                ))}
                <th scope="col" className="figure">
                  Released
                </th>
              </tr>
            </thead>
            <tbody>
              {data.flavours.map((row) => (
                <tr key={row.flavour}>
                  <th scope="row">{FLAVOUR_NAMES[row.flavour] ?? row.flavour}</th>
                  {COLUMNS.map(([key]) => (
                    <td key={key} className="num figure">
                      {row[key]}
                    </td>
                  ))}
                  <td className="num figure">{row.released ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
