import type { InventoryRow, StockMovement } from "../../shared/api";
import { shortDateTime } from "../../shared/format";
import { Loading, Panel } from "../components/Panel";
import { useLive } from "../lib/live";
import { Link } from "../lib/router";
import { useData } from "../lib/useData";
import { PageTitle, TableWrap, useFilters } from "./ui";

export function InventoryList() {
  const [filters, setFilters] = useFilters(["low"] as const);
  const low = filters.low === "1";
  const { data, loading, reload } = useData<InventoryRow[]>(`/api/admin/inventory${low ? "?low_stock=true" : ""}`);
  useLive("stock", () => void reload());

  return (
    <>
      <PageTitle>Inventory</PageTitle>
      <label className="check">
        <input type="checkbox" checked={low} onChange={(event) => setFilters({ low: event.target.checked ? "1" : "" }, false)} />
        Low stock only
      </label>
      {loading || !data ? (
        <Loading />
      ) : (
        <TableWrap>
          <table className="tbl" aria-label="Stock">
            <thead>
              <tr>
                <th scope="col">SKU</th>
                <th scope="col">Product</th>
                <th scope="col">Colour</th>
                <th scope="col">Size</th>
                <th scope="col">Bhiwandi</th>
                <th scope="col">Gurugram</th>
                <th scope="col">Available</th>
                <th scope="col">On hand</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={row.sku}>
                  <th scope="row">
                    <Link href={`/admin/inventory/${row.sku}`}>{row.sku}</Link>
                  </th>
                  <td>{row.product}</td>
                  <td>{row.colour}</td>
                  <td>{row.size}</td>
                  {row.locations.map((l) => (
                    <td key={l.location}>
                      {l.available} available, {l.reserved} reserved, {l.committed} committed, {l.on_hand} on hand
                    </td>
                  ))}
                  <td>{row.available}</td>
                  <td>{row.on_hand}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </>
  );
}

export function MovementsPage({ sku }: { sku: string }) {
  const { data, loading, error, reload } = useData<StockMovement[]>(`/api/admin/inventory/${sku}/movements`);
  useLive("stock", (event) => {
    if (event.sku === sku) void reload();
  });
  if (error) return <Panel tone="red">{error.message}</Panel>;
  if (loading || !data) return <Loading />;
  return (
    <>
      <PageTitle>{sku}</PageTitle>
      <p>
        <Link href="/admin/inventory">Back to inventory</Link>
      </p>
      <TableWrap>
        <table className="tbl" aria-label="Stock movements">
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">Reason</th>
              <th scope="col">Reference</th>
              <th scope="col">Entries</th>
            </tr>
          </thead>
          <tbody>
            {data.map((movement) => (
              <tr key={movement.movement_id}>
                <td>{shortDateTime(movement.at)}</td>
                <td>{movement.reason}</td>
                <td>{movement.ref}</td>
                <td>
                  {movement.entries.map((e, i) => (
                    <span key={i} className="entry">
                      {e.account} at {e.location}: {e.quantity > 0 ? `+${e.quantity}` : e.quantity}
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </>
  );
}
