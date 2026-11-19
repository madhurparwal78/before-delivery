import { useState } from "react";
import { ApiError, postJson, useDesk } from "../desk_context.js";
import { feedback } from "../feedback.js";
import { ReviewDialog, useCommand } from "../review.js";

export function KeepersWorkspace(): React.ReactElement {
  const desk = useDesk();
  const runCommand = useCommand();
  const state = desk.state;
  const namespace = desk.session?.namespace ?? "hollowmint";
  const [order, setOrder] = useState<string[] | null>(null);
  const [pickedIndex, setPickedIndex] = useState<number | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [undoReview, setUndoReview] = useState(false);

  const current = order ?? state?.keeper_order ?? [];
  const specimens = state?.specimens ?? {};

  const move = (from: number, to: number) => {
    const next = [...current];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setOrder(next);
    if (specimens[item]) {
      desk.announce(feedback("F_REORDER", { specimen: specimens[item].display_label, position: to + 1, count: next.length }));
    }
  };

  const onListKeyDown = (event: React.KeyboardEvent, index: number) => {
    if (event.key === " ") {
      event.preventDefault();
      setPickedIndex(pickedIndex === index ? null : index);
      return;
    }
    if (event.key === "Escape" && pickedIndex !== null) {
      if (order) {
        setOrder(null);
      }
      setPickedIndex(null);
      return;
    }
    if (pickedIndex === index) {
      if (event.key === "ArrowUp") {
        event.preventDefault();
        if (index > 0) move(pickedIndex, pickedIndex - 1);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        if (index < current.length - 1) move(pickedIndex, pickedIndex + 1);
      } else if (event.key === "Enter") {
        event.preventDefault();
        setPickedIndex(null);
      }
    }
  };

  const confirmOrder = async () => {
    const commandId = `keeper-${Date.now()}`;
    await runCommand(commandId, async () => {
      try {
        await fetch(`/api/desks/${namespace}/keeper-order`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            command_id: commandId,
            expected_version: state?.versions.keeper_order,
            order: current,
          }),
        });
        desk.announce(feedback("F_KEEPER_OK"));
        setReviewOpen(false);
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

  const confirmUndo = async () => {
    const commandId = `keeper-undo-${Date.now()}`;
    await runCommand(commandId, async () => {
      try {
        await postJson(`/api/desks/${namespace}/keeper-order/undo`, {
          command_id: commandId,
          expected_version: state?.versions.keeper_order,
        });
        desk.announce(feedback("F_UNDO_OK"));
        setUndoReview(false);
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
    <div aria-label="Keeper preference workspace" className="workspace-two-col">
      <div className="panel" aria-label="Keeper list">
        <h3>Keeper preference</h3>
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }} aria-label="Keeper preference">
          {current.map((key, index) => {
            const specimen = specimens[key];
            return (
              <li key={key}>
                <button
                  className={`specimen-chip${pickedIndex === index ? " picked" : ""}`}
                  aria-label={`Specimen ${key}`}
                  draggable
                  onDragStart={() => setPickedIndex(index)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (pickedIndex !== null && pickedIndex !== index) move(pickedIndex, index);
                    setPickedIndex(null);
                  }}
                  onKeyDown={(e) => onListKeyDown(e, index)}
                  onClick={() => setPickedIndex(pickedIndex === index ? null : index)}
                >
                  <span className="coin-disc">{specimen?.attribution.mintmark || "?"}</span>
                  <span>
                    <span className="chip-label">{index === 0 ? `Keeper — ${specimen?.display_label}` : specimen?.display_label}</span>
                    <span className="chip-sub">Position {index + 1} of {current.length}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="panel">
        <h3>Focused specimen</h3>
        <div className="fact-box" aria-label="Obverse facts">
          <h3>Obverse facts</h3>
          <p>{current[0] ? specimens[current[0]]?.display_label : "—"}</p>
        </div>
        <button className="btn btn-primary" aria-label="Review keeper order" onClick={() => setReviewOpen(true)}>
          Review keeper order
        </button>{" "}
        <button className="btn" aria-label="Undo last move" onClick={() => setUndoReview(true)}>
          Undo last move
        </button>
      </div>
      {reviewOpen && (
        <ReviewDialog
          title="Save keeper order"
          summary={`Save order ${current.join(", ")}.`}
          onConfirm={() => void confirmOrder()}
          onCancel={() => setReviewOpen(false)}
        />
      )}
      {undoReview && (
        <ReviewDialog
          title="Save keeper order"
          summary="Undo the last confirmed keeper move."
          onConfirm={() => void confirmUndo()}
          onCancel={() => setUndoReview(false)}
        />
      )}
    </div>
  );
}
