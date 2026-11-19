// Tray placement: move a holder into a tray cell and confirm it through "Place holder".
// Cells and holders are drawn to their millimetre sizes at one shared scale.

import { useState } from "react";
import { CELLS, type Cell } from "../../shared/limits";
import { jsonCommand } from "../commands";
import { useDesk } from "../desk";
import { useMoves } from "../moves";
import { CELL_SIZE, FactBoxes, HolderShape, label, Workspace } from "../parts";
import { Review } from "../Review";

interface Staged {
  specimen: string;
  cell: Cell;
}

export function Tray() {
  const { state, send } = useDesk();
  const [staged, setStaged] = useState<Staged | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [cellError, setCellError] = useState<{ cell: Cell; copy: string } | null>(null);
  const moves = useMoves((source, destination) => {
    setStaged({ specimen: source, cell: destination as Cell });
    setCellError(null);
  });
  if (!state) return null;
  const holders = Object.entries(state.specimens).filter(([, s]) => s.owner === "dealer" && !["transferred", "missing", "outbound"].includes(s.status));
  const occupant = (cell: Cell) => state.tray[cell]?.specimen ?? null;

  const confirm = async () => {
    const plan = staged!;
    const outcome = await send(jsonCommand("tray", "POST", "/tray/placements", { expected_version: state.versions.tray, specimen: plan.specimen, cell: plan.cell }));
    if (outcome.ok) setStaged(null);
    else if (outcome.error?.fields?.cell) setCellError({ cell: plan.cell, copy: outcome.error.fields.cell });
    else if (outcome.error) setCellError({ cell: plan.cell, copy: outcome.error.message });
    return "close" as const;
  };

  return (
    <Workspace name="Tray placement workspace" heading="Tray placement · Crown tray 1" list="stock" className="ws-tray" facts={<FactBoxes specimenKey={staged?.specimen ?? holders[0]?.[0] ?? "A"} specimen={state.specimens[staged?.specimen ?? holders[0]?.[0] ?? "A"]} />}>
      <div className="area-tray tray-box">
        <div className="tray-grid" style={{ gridTemplateColumns: `repeat(2, minmax(44px, ${CELL_SIZE}))` }}>
          {CELLS.map((cell) => {
            const inCell = staged?.cell === cell ? staged.specimen : occupant(cell);
            const ghost = staged?.cell === cell;
            return (
              <div key={cell} className="cell-wrap">
                <button type="button" className={ghost ? "tray-cell staged" : "tray-cell"} style={{ aspectRatio: "1" }} {...moves.destination(cell)}>
                  <span className="sr-only">{`Cell ${cell}`}</span>
                  <span className="cell-name figures" aria-hidden="true">{cell}</span>
                  {inCell && state.specimens[inCell] && <HolderShape holder={state.specimens[inCell]!.holder} mintmark={state.specimens[inCell]!.attribution.mintmark} />}
                  {inCell && <span className="cell-caption" aria-hidden="true">{ghost ? `${label(inCell)} (staged)` : label(inCell)}</span>}
                </button>
                {cellError?.cell === cell && <p className="field-error">{cellError.copy}</p>}
              </div>
            );
          })}
        </div>
        <p className="caption-text figures">Cells are 60 × 60 mm, drawn at the same scale as the holders.</p>
      </div>
      <div className="area-holders holder-list">
        <h2 className="box-heading">Holders:</h2>
        <ul>
          {holders.map(([key, s]) => (
            <li key={key}>
              <button type="button" className="holder-button" {...moves.source(key)}>
                <span className="sr-only">{`Holder ${key}`}</span>
                <HolderShape holder={s.holder} mintmark={s.attribution.mintmark} />
                <span className="holder-text" aria-hidden="true">
                  <strong>{label(key)}</strong>
                  <span className="figures">
                    {s.holder.kind} {s.holder.width_mm} × {s.holder.height_mm} mm
                  </span>
                  {moves.picked === key && <span>Picked up. Choose a cell.</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="area-review actions">
        <button type="button" className="button primary" onClick={() => setReviewing(true)}>
          Review placement
        </button>
      </div>
      {reviewing && (
        <Review
          label="Place holder"
          onClose={() => setReviewing(false)}
          onConfirm={confirm}
          confirmDisabled={!staged}
          summary={
            staged ? (
              <p>
                Places <strong>Holder {staged.specimen}</strong> ({state.specimens[staged.specimen]?.holder.kind} {state.specimens[staged.specimen]?.holder.width_mm} ×{" "}
                {state.specimens[staged.specimen]?.holder.height_mm} mm) for <strong>{label(staged.specimen)}</strong> in <strong>Cell {staged.cell}</strong>.
              </p>
            ) : (
              <p>No holder is staged. Move a holder onto a cell first.</p>
            )
          }
        />
      )}
    </Workspace>
  );
}
