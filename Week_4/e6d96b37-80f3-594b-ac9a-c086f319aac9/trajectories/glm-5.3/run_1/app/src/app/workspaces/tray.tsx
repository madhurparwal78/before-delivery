import { useState } from "react";
import { TRAY_CELLS, TRAY_CELL_MM } from "../../shared/util.js";
import { ApiError, postJson, useDesk } from "../desk_context.js";
import { feedback } from "../feedback.js";
import { ReviewDialog, useCommand } from "../review.js";

export function TrayWorkspace(): React.ReactElement {
  const desk = useDesk();
  const runCommand = useCommand();
  const state = desk.state;
  const namespace = desk.session?.namespace ?? "hollowmint";
  const [picked, setPicked] = useState<string | null>(null);
  const [pendingCell, setPendingCell] = useState<string | null>(null);
  const [cellError, setCellError] = useState<string | null>(null);

  const tray = state?.tray ?? {};
  const specimens = state
    ? Object.entries(state.specimens).filter(([, s]) => s.owner === "dealer" && s.status !== "outbound" && s.status !== "transferred" && s.status !== "reserved")
    : [];

  const stage = (cell: string) => {
    if (!picked) return;
    const specimen = state?.specimens[picked];
    if (specimen && (specimen.holder.width_mm > TRAY_CELL_MM || specimen.holder.height_mm > TRAY_CELL_MM)) {
      setCellError(feedback("F_TRAY_SIZE"));
      desk.reportError(feedback("F_TRAY_SIZE"));
      return;
    }
    const occupant = tray[cell]?.specimen;
    if (occupant && occupant !== picked) {
      setCellError(feedback("F_TRAY_TAKEN"));
      desk.reportError(feedback("F_TRAY_TAKEN"));
      return;
    }
    setCellError(null);
    setPendingCell(cell);
  };

  const confirmPlace = async () => {
    if (!pendingCell || !picked) return;
    const commandId = `tray-${Date.now()}`;
    await runCommand(commandId, async () => {
      try {
        await postJson(`/api/desks/${namespace}/tray/placements`, {
          command_id: commandId,
          expected_version: state?.versions.tray,
          specimen: picked,
          cell: pendingCell,
        });
        desk.announce(feedback("F_TRAY_OK"));
        setPendingCell(null);
        setPicked(null);
        await desk.refresh();
      } catch (err) {
        if (err instanceof ApiError) {
          desk.reportError(err.failure.body.message);
          return;
        }
        throw err;
      }
    });
  };

  return (
    <div aria-label="Tray placement workspace" className="workspace-two-col">
      <div className="panel" aria-label="Tray">
        <h3>Crown tray 1</h3>
        <div className="tray-grid" aria-label="Audit tray" role="group">
          {TRAY_CELLS.map((cell) => {
            const occupant = tray[cell]?.specimen;
            const specimen = occupant ? state?.specimens[occupant] : undefined;
            const widthMm = specimen?.holder.width_mm ?? 0;
            const heightMm = specimen?.holder.height_mm ?? 0;
            const scale = 1.4;
            return (
              <button
                key={cell}
                className={`tray-cell${picked ? " selected" : ""}`}
                aria-label={`Cell ${cell}`}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const key = e.dataTransfer.getData("text/plain");
                  if (key) {
                    setPicked(key);
                    stage(cell);
                  }
                }}
                onClick={() => stage(cell)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && picked) stage(cell);
                }}
              >
                {specimen ? (
                  <span
                    className="holder-shape"
                    style={{ width: widthMm * scale, height: heightMm * scale }}
                  >
                    {specimen.holder.kind === "slab" ? "slab" : specimen.holder.kind === "capsule" ? "cap" : "flip"}
                  </span>
                ) : (
                  cell
                )}
              </button>
            );
          })}
        </div>
        {cellError && <span className="field-error">{cellError}</span>}
      </div>
      <div className="panel" aria-label="Holders">
        <h3>Holders</h3>
        {specimens.map(([key, s]) => (
          <button
            key={key}
            className={`specimen-chip${picked === key ? " picked" : ""}`}
            aria-label={`Holder ${key}`}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData("text/plain", key);
              setPicked(key);
            }}
            onClick={() => setPicked(picked === key ? null : key)}
            onKeyDown={(e) => {
              if (e.key === " ") {
                e.preventDefault();
                setPicked(picked === key ? null : key);
              }
              if (e.key === "Escape") setPicked(null);
            }}
          >
            <span className="coin-disc">{s.attribution.mintmark || "?"}</span>
            <span>
              <span className="chip-label">{s.display_label}</span>
              <span className="chip-sub">{s.holder.kind} {s.holder.width_mm}×{s.holder.height_mm} mm</span>
            </span>
          </button>
        ))}
        <button className="btn btn-primary" aria-label="Review placement" disabled={!picked || !pendingCell} onClick={() => setPendingCell(pendingCell)}>
          Review placement
        </button>
      </div>
      {pendingCell && picked && (
        <ReviewDialog
          title="Place holder"
          summary={`Place ${state?.specimens[picked]?.display_label} into cell ${pendingCell}.`}
          onConfirm={() => void confirmPlace()}
          onCancel={() => setPendingCell(null)}
        />
      )}
    </div>
  );
}
