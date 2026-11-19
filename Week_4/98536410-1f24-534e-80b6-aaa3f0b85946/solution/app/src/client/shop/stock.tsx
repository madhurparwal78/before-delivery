import { type RefObject, useEffect, useRef, useState } from "react";
import { newRequestKey } from "../lib/api";
import { Figure } from "../lib/figure";
import { Overlay } from "../lib/overlay";
import type { StockLine } from "../types";

export function StockTable({ lines, onCount }: { lines: StockLine[]; onCount: (line: StockLine, opener: HTMLElement) => void }) {
  return (
    <div className="charcoal-panel scroll-x">
      <table aria-label="Stock">
        <thead>
          <tr><th scope="col">Item</th><th scope="col">On hand</th><th scope="col">Held</th><th scope="col">Available</th><th scope="col">Count</th></tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.sku}>
              <td><strong>{line.sku}</strong> {line.name}</td>
              <td><Figure kind="on-hand" value={line.on_hand} /></td>
              <td><Figure kind="held" value={line.held} /></td>
              <td><Figure kind="available" value={line.available} /></td>
              <td><button type="button" className="btn" aria-label={`Count ${line.sku}`} onClick={(event) => onCount(line, event.currentTarget)}>Count</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CountDialog({ line, open, opener, onClose, save }: {
  line: StockLine | null; open: boolean; opener: RefObject<HTMLElement | null>; onClose: () => void; save: (line: StockLine, counted: number) => Promise<boolean>;
}) {
  const [counted, setCounted] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open && line) setCounted(String(line.on_hand));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, line?.sku]);
  async function submit() {
    if (!line || busy) return;
    setBusy(true);
    const saved = await save(line, Number(counted));
    setBusy(false);
    if (saved) onClose();
  }
  return (
    <Overlay open={open} role="dialog" label="Stock count" onClose={onClose} opener={opener} className="dialog">
      <h2>Stock count</h2>
      <p>{line ? `${line.sku} ${line.name}` : ""}</p>
      <label className="field-label" htmlFor="counted">Counted units</label>
      <input id="counted" className="field" type="number" min={0} max={99999} value={counted} onChange={(event) => setCounted(event.target.value)} />
      <div className="dialog-actions">
        <button type="button" className="btn" aria-disabled={busy} onClick={() => void submit()}>Save count</button>
        <button type="button" className="btn" onClick={onClose}>Close</button>
      </div>
    </Overlay>
  );
}

export function TillDialog({ lines, open, opener, onClose, sell }: {
  lines: StockLine[]; open: boolean; opener: RefObject<HTMLElement | null>; onClose: () => void;
  sell: (key: string, sku: string, quantity: number) => Promise<boolean>;
}) {
  const [sku, setSku] = useState("");
  const [units, setUnits] = useState("1");
  const [busy, setBusy] = useState(false);
  const attempt = useRef<{ key: string; body: string } | null>(null);
  useEffect(() => {
    if (open) {
      setSku(lines[0]?.sku ?? "");
      setUnits("1");
      attempt.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  async function submit() {
    if (busy) return;
    const body = JSON.stringify({ sku, quantity: Number(units) });
    const same = attempt.current !== null && attempt.current.body === body;
    attempt.current = same && attempt.current ? attempt.current : { key: newRequestKey(), body };
    setBusy(true);
    const done = await sell(attempt.current.key, sku, Number(units));
    setBusy(false);
    if (done) onClose();
  }
  return (
    <Overlay open={open} role="dialog" label="Till sale" onClose={onClose} opener={opener} className="dialog">
      <h2>Till sale</h2>
      <label className="field-label" htmlFor="till-item">Item</label>
      <select id="till-item" className="field" value={sku} onChange={(event) => setSku(event.target.value)}>
        {lines.map((line) => <option key={line.sku} value={line.sku}>{`${line.sku} ${line.name}`}</option>)}
      </select>
      <label className="field-label" htmlFor="till-units">Units</label>
      <input id="till-units" className="field" type="number" min={1} max={999} value={units} onChange={(event) => setUnits(event.target.value)} />
      <div className="dialog-actions">
        <button type="button" className="btn" aria-disabled={busy} onClick={() => void submit()}>Record sale</button>
        <button type="button" className="btn" onClick={onClose}>Close</button>
      </div>
    </Overlay>
  );
}
