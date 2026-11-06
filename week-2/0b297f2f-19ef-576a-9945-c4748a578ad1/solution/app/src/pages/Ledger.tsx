import type { KeyboardEvent } from "react";
import { formatLength, type Unit } from "../../shared/units";
import { luxHours, luxText, statusText } from "../format";
import type { Layout } from "../layout";
import type { Placement } from "../types";

interface LedgerProps {
  rows: Placement[] | null;
  layout: Layout;
  unit: Unit;
  selectedId: string | null;
  onSelect: (p: Placement) => void;
  onHandleKey: (e: KeyboardEvent<HTMLButtonElement>, p: Placement) => void;
}

/** The Scene ledger: one row per placed work, the server's figures, a handle per work. */
export function Ledger({ rows, layout, unit, selectedId, onSelect, onHandleKey }: LedgerProps) {
  const full = layout !== "phone";
  return (
    <div className="ledger-wrap">
      <table aria-label="Scene ledger" className="ledger">
        <thead>
          <tr>
            <th scope="col">Work</th>
            {full && <th scope="col">Wall</th>}
            <th scope="col" className="num">
              Offset
            </th>
            {full && (
              <>
                <th scope="col" className="num">
                  Centre height
                </th>
                <th scope="col" className="num">
                  Lux
                </th>
                <th scope="col" className="num">
                  Lux-hours
                </th>
              </>
            )}
            <th scope="col">Lux status</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {!rows
            ? [0, 1, 2].map((i) => (
                <tr key={i} className="skeleton-row" aria-hidden="true">
                  <td colSpan={full ? 8 : 4}>
                    <span />
                  </td>
                </tr>
              ))
            : rows.map((p) => (
                <tr key={p.id} data-selected={p.id === selectedId ? "true" : undefined}>
                  <td className="ledger-work">
                    <button
                      type="button"
                      className="handle"
                      data-handle={p.id}
                      aria-pressed={p.id === selectedId}
                      onClick={() => onSelect(p)}
                      onKeyDown={(e) => onHandleKey(e, p)}
                    >
                      {p.objectTitle}
                    </button>
                  </td>
                  {full && <td className="nowrap">{p.wallName}</td>}
                  <td className="num">{formatLength(p.offsetMm, unit)}</td>
                  {full && (
                    <>
                      <td className="num">{formatLength(p.centreHeightMm, unit)}</td>
                      <td className="num">{luxText(p.plannedLux)}</td>
                      <td className="num">{luxHours(p.plannedLuxHours)}</td>
                    </>
                  )}
                  <td className="nowrap">
                    <LuxStatus placement={p} />
                  </td>
                  <td>
                    {statusText(p.status, p.claimedBy?.name ?? null)}
                  </td>
                </tr>
              ))}
        </tbody>
      </table>
      {layout === "tablet" && (
        <p className="ledger-cue" aria-hidden="true">
          Scroll the ledger sideways for every column.
        </p>
      )}
    </div>
  );
}

/** The server's lux status in words, an over-budget work in brick with its hatch swatch. */
export function LuxStatus({ placement }: { placement: Placement }) {
  if (placement.luxStatus === "within") return <>Within limit</>;
  return (
    <span className="lux-over">
      <span className="hatch-swatch" aria-hidden="true" />
      Over budget
    </span>
  );
}
