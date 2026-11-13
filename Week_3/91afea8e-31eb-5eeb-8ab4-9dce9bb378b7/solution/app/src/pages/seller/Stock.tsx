import { useState, type ReactNode } from "react";
import { Button } from "../../components/Button";
import { Empty } from "../../components/Empty";
import { ApiFailure, failureMessage, put } from "../../lib/api";
import { useTitle } from "../../lib/hooks";
import { Failure, Loading, StaffGate, useResource, wholeNumber, type ListingItem } from "./staff";

interface LowStock {
  listing_id: string;
  title: string;
  stock: number;
}

function Row({ item, onSaved, onStatus }: { item: LowStock; onSaved: (stock: number) => void; onStatus: (text: string) => void }): ReactNode {
  const [text, setText] = useState(String(item.stock));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  const save = async (): Promise<void> => {
    setBusy(true);
    setProblem("");
    try {
      const saved = await put<ListingItem>(`/api/seller/listings/${item.listing_id}/stock`, { stock: wholeNumber(text) });
      onSaved(saved.stock);
      setText(String(saved.stock));
      onStatus(`Stock saved: ${item.title}, ${saved.stock} units.`);
    } catch (error) {
      if (error instanceof ApiFailure && error.body.errors?.stock) setProblem(error.body.errors.stock);
      onStatus(`Not saved: ${failureMessage(error)}`);
    }
    setBusy(false);
  };

  return (
    <tr role="row">
      <td role="cell" data-label="Item" className="rtable__title">
        {item.title}
      </td>
      <td role="cell" data-label="In stock">{item.stock}</td>
      <td role="cell" data-label="New stock">
        <div className="field">
          <input type="number" inputMode="numeric" step="1" min="0" max="9999" aria-label={`Stock for ${item.title}`} value={text} onChange={(event) => setText(event.target.value)} />
          {problem && <p className="field-error">{problem}</p>}
        </div>
      </td>
      <td role="cell" data-label="Save">
        <Button variant="primary" busy={busy} onClick={() => void save()} aria-label={`Save stock for ${item.title}`}>
          Save stock
        </Button>
      </td>
    </tr>
  );
}

function StockPage(): ReactNode {
  useTitle("low stock");
  const { resource, update } = useResource<{ listings: LowStock[] }>("/api/seller/low-stock");
  const [status, setStatus] = useState("");

  if (resource.phase === "failed") return <Failure status={resource.status} message={resource.message} />;
  const items = resource.phase === "ready" ? resource.data.listings : null;

  return (
    <>
      <section className="panel panel--ground staff-head">
        <h1>low stock</h1>
      </section>
      {items === null && <Loading />}
      {items?.length === 0 && (
        <Empty tone="black" sign="box">
          nothing is running low.
        </Empty>
      )}
      {items && items.length > 0 && (
        <section className="panel panel--black staff-results">
          <table role="table" className="rtable rtable--stock" aria-label="Low stock">
            <thead role="rowgroup">
              <tr role="row">
                <th role="columnheader" scope="col">Item</th>
                <th role="columnheader" scope="col">In stock</th>
                <th role="columnheader" scope="col">New stock</th>
                <th role="columnheader" scope="col">Save</th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              {items.map((item) => (
                <Row
                  key={item.listing_id}
                  item={item}
                  onStatus={setStatus}
                  onSaved={(stock) => update((data) => ({ listings: data.listings.map((row) => (row.listing_id === item.listing_id ? { ...row, stock } : row)) }))}
                />
              ))}
            </tbody>
          </table>
          <p className="status status-bar" role="status" aria-label="Save status">
            {status}
          </p>
        </section>
      )}
    </>
  );
}

export default function Stock(): ReactNode {
  return (
    <StaffGate role="seller">
      <StockPage />
    </StaffGate>
  );
}
