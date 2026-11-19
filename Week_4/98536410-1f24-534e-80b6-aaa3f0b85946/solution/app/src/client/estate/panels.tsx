import { type FormEvent, type RefObject, useEffect, useRef, useState } from "react";
import { Figure } from "../lib/figure";
import { lisbonClock } from "../lib/format";
import { Overlay } from "../lib/overlay";
import type { StockLine, Shop } from "../types";
import { STATE_DEFINITIONS, StateDot, definitionOf } from "./stateDef";

export function Legend({ counts }: { counts: Record<string, number> }) {
  return (
    <ul className="legend" aria-label="Map legend">
      {STATE_DEFINITIONS.map((definition) => (
        <li key={definition.key}>
          <StateDot state={definition.key} />
          <span className="legend-label">{definition.label}</span>
          <Figure kind="legend-count" value={counts[definition.key] ?? 0} />
        </li>
      ))}
    </ul>
  );
}

interface TableProps {
  shops: Shop[];
  onDetails: (shop: Shop, opener: HTMLElement) => void;
  onSuspend: (shop: Shop, opener: HTMLElement) => void;
  onResume: (shop: Shop) => void;
  tableRef: RefObject<HTMLDivElement | null>;
}

export function ShopsTable({ shops, onDetails, onSuspend, onResume, tableRef }: TableProps) {
  return (
    <div className="charcoal-panel scroll-x shops-table" ref={tableRef} role="table" aria-label="Shops" tabIndex={-1} id="shops-table">
      <div role="rowgroup">
        <div role="row" className="trow thead">
          {["Shop", "City", "State", "Critical lines", "Closes", "Actions"].map((name) => (
            <div key={name} role="columnheader">{name}</div>
          ))}
        </div>
      </div>
      <div role="rowgroup">
        {shops.map((shop) => (
          <div key={shop.id} role="row" className="trow" data-store-id={shop.id} data-marker-state={shop.display_state}>
            <div role="cell" className="strong">{shop.name}</div>
            <div role="cell">{shop.city}</div>
            <div role="cell" className="state-cell"><StateDot state={shop.display_state} size={24} />{definitionOf(shop.display_state).label}</div>
            <div role="cell"><Figure kind="critical-lines" value={shop.critical_lines} /></div>
            <div role="cell">{shop.closes_local ?? "—"}</div>
            <div role="cell" className="actions">
              <button type="button" className="btn" aria-label={`Details for ${shop.name}`} onClick={(event) => onDetails(shop, event.currentTarget)}>Details</button>
              {shop.suspended ? (
                <button type="button" className="btn" aria-label={`Resume ${shop.name}`} onClick={() => onResume(shop)}>Resume</button>
              ) : (
                <button type="button" className="btn" aria-label={`Suspend ${shop.name}`} onClick={(event) => onSuspend(shop, event.currentTarget)}>Suspend</button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SuspendDialog({ shop, open, onClose, onSaved, opener, save }: {
  shop: Shop | null; open: boolean; onClose: () => void; onSaved: () => void; opener: RefObject<HTMLElement | null>;
  save: (shop: Shop, reason: string) => Promise<boolean>;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (open) {
      setReason("");
      setError("");
    }
  }, [open]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!shop) return;
    if (reason.trim() === "") {
      setError("Give a reason.");
      return;
    }
    if (await save(shop, reason.trim())) onSaved();
  }
  return (
    <Overlay open={open} role="dialog" label="Suspend shop" onClose={onClose} opener={opener} className="dialog" initialFocus="textarea, input">
      <form onSubmit={(event) => void submit(event)} noValidate>
        <h2>Suspend shop</h2>
        <p>{shop?.name}</p>
        <label className="field-label" htmlFor="suspend-reason">Reason</label>
        <input
          id="suspend-reason" className="field" type="text" value={reason} aria-invalid={error ? true : undefined}
          aria-describedby={error ? "suspend-reason-error" : undefined} onChange={(event) => setReason(event.target.value)}
        />
        {error ? <p id="suspend-reason-error" className="field-error">{error}</p> : null}
        <div className="dialog-actions">
          <button type="submit" className="btn">Suspend</button>
          <button type="button" className="btn" onClick={onClose}>Keep open</button>
        </div>
      </form>
    </Overlay>
  );
}

export function DetailPanel(props: {
  open: boolean; restored: boolean; shop: Shop | null; stock: StockLine[]; opener: RefObject<HTMLElement | null>; wide: boolean;
  onClose: () => void; onSuspend: (shop: Shop, opener: HTMLElement) => void; onResume: (shop: Shop) => void;
  initialFocus: string | null; onScroll: (top: number) => void; onFocusPart: (part: "close" | "suspend" | "heading") => void; scrollTop: number;
}) {
  const { open, restored, shop, stock, opener, wide, onClose, onSuspend, onResume, initialFocus, onScroll, onFocusPart, scrollTop } = props;
  const node = useRef<HTMLDivElement | null>(null);
  const critical = stock.filter((line) => line.critical);
  useEffect(() => {
    if (restored && node.current) node.current.scrollTop = scrollTop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restored, shop?.id]);
  if (!shop) return null;
  return (
    <Overlay
      open={open} restored={restored} role="region" label="Shop detail" modal={!wide} trap={!wide} onClose={onClose} opener={opener}
      className="detail-panel" initialFocus={initialFocus} keepFocus={restored && initialFocus === null}
    >
      <div
        className="detail-scroll" ref={node} onScroll={(event) => onScroll(event.currentTarget.scrollTop)}
        onFocusCapture={(event) => {
          const target = event.target as HTMLElement;
          onFocusPart(target.matches("h2") ? "heading" : target.dataset.part === "suspend" ? "suspend" : "close");
        }}
      >
        <h2 tabIndex={-1}>{shop.name}</h2>
        <p className="state-line"><StateDot state={shop.display_state} size={24} /> {definitionOf(shop.display_state).label}</p>
        <p>Closes {shop.closes_local ?? "—"}</p>
        <p>Critical lines <Figure kind="critical-lines" value={shop.critical_lines} className="big" /></p>
        <div className="scroll-x">
          <table aria-label="Critical lines">
            <thead>
              <tr><th scope="col">Item</th><th scope="col">On hand</th><th scope="col">Available</th></tr>
            </thead>
            <tbody>
              {critical.map((line) => (
                <tr key={line.sku}><td>{line.sku} {line.name}</td><td>{line.on_hand}</td><td>{line.available}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="dialog-actions">
          {shop.suspended ? (
            <button type="button" className="btn" data-part="suspend" onClick={() => onResume(shop)}>Resume shop</button>
          ) : (
            <button type="button" className="btn" data-part="suspend" onClick={(event) => onSuspend(shop, event.currentTarget)}>Suspend shop</button>
          )}
          <button type="button" className="btn" data-part="close" onClick={onClose}>Close detail</button>
        </div>
      </div>
    </Overlay>
  );
}

const KEY_STEPS: Record<string, number> = { ArrowRight: 10, ArrowUp: 10, ArrowLeft: -10, ArrowDown: -10, PageUp: 100, PageDown: -100 };

export function Scrubber({ value, onChange, count, readout }: { value: number; onChange: (value: number) => void; count: number; readout: string }) {
  return (
    <div className="scrubber">
      <div className="scrub-row">
        <input
          type="range" min={0} max={1000} step={1} value={value} aria-label="Review last 24 hours" className="slider"
          onChange={(event) => onChange(Number(event.target.value))}
          onKeyDown={(event) => {
            const step = KEY_STEPS[event.key];
            if (step !== undefined) {
              event.preventDefault();
              onChange(Math.min(1000, Math.max(0, value + step)));
            } else if (event.key === "Home") {
              event.preventDefault();
              onChange(0);
            } else if (event.key === "End") {
              event.preventDefault();
              onChange(1000);
            }
          }}
        />
        {readout ? <Figure kind="review-count" value={count} className="review-count" /> : <span className="review-count" />}
      </div>
      <p role="status" aria-label="Review readout" className="readout">{readout}</p>
    </div>
  );
}

export function readoutText(count: number, moment: number): string {
  return `${count} orders by ${lisbonClock(moment)} Lisbon time`;
}
