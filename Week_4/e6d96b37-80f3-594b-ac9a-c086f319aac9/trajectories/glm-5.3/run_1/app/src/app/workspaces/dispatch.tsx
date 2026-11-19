import { useState } from "react";
import { ApiError, postJson, useDesk } from "../desk_context.js";
import { feedback } from "../feedback.js";
import { ReviewDialog, useCommand } from "../review.js";

export function DispatchWorkspace(): React.ReactElement {
  const desk = useDesk();
  const runCommand = useCommand();
  const state = desk.state;
  const namespace = desk.session?.namespace ?? "hollowmint";
  const isDealer = desk.session?.role === "dealer";
  const [selectedOffer, setSelectedOffer] = useState<string>("");
  const [order, setOrder] = useState<string[] | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);

  const offerKey = selectedOffer || Object.keys(state?.offers ?? {}).find((k) => state?.offers[k].status === "accepted") || "";
  const offer = state?.offers[offerKey];
  const party = isDealer ? "dealer" : "counterpart";
  const manifest = state?.manifests[`${offerKey}/${party}`];
  const items = isDealer ? offer?.dealer_items ?? [] : offer?.counterpart_items ?? [];
  const current = order ?? manifest?.order ?? items;

  const move = (from: number, to: number) => {
    const next = [...current];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setOrder(next);
    if (state?.specimens[item]) {
      desk.announce(feedback("F_REORDER", { specimen: state.specimens[item].display_label, position: to + 1, count: next.length }));
    }
  };

  const [pickedIndex, setPickedIndex] = useState<number | null>(null);

  const onItemKeyDown = (event: React.KeyboardEvent, index: number) => {
    if (event.key === " ") {
      event.preventDefault();
      setPickedIndex(pickedIndex === index ? null : index);
      return;
    }
    if (event.key === "Escape" && pickedIndex !== null) {
      if (order) setOrder(null);
      setPickedIndex(null);
      return;
    }
    if (pickedIndex === index) {
      if (event.key === "ArrowUp" && index > 0) {
        event.preventDefault();
        move(pickedIndex, pickedIndex - 1);
      } else if (event.key === "ArrowDown" && index < current.length - 1) {
        event.preventDefault();
        move(pickedIndex, pickedIndex + 1);
      } else if (event.key === "Enter") {
        event.preventDefault();
        setPickedIndex(null);
      }
    }
  };

  const confirmFreeze = async () => {
    const commandId = `freeze-${Date.now()}`;
    await runCommand(commandId, async () => {
      try {
        await postJson(`/api/desks/${namespace}/offers/${offerKey}/manifests/${party}/freeze`, {
          command_id: commandId,
          expected_version: manifest?.version ?? 1,
          order: current,
        });
        desk.announce(feedback("F_DISPATCH_OK"));
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

  const focused = current[0];

  return (
    <div aria-label="Dispatch workspace" className="workspace-two-col">
      <div className="panel" aria-label="Packing manifest">
        <h3>Packing manifest</h3>
        <ul style={{ listStyle: "none", padding: 0 }} aria-label="Packing manifest">
          {current.map((key, index) => {
            const specimen = state?.specimens[key];
            const photo = specimen?.photos.find((p) => p.label === "obverse");
            return (
              <li key={key}>
                <button
                  className={`specimen-chip${pickedIndex === index ? " picked" : ""}`}
                  aria-label={`Manifest item ${key}`}
                  draggable
                  onDragStart={() => setPickedIndex(index)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (pickedIndex !== null && pickedIndex !== index) move(pickedIndex, index);
                    setPickedIndex(null);
                  }}
                  onKeyDown={(e) => onItemKeyDown(e, index)}
                  onClick={() => setPickedIndex(pickedIndex === index ? null : index)}
                >
                  {photo && <img src={`/api/desks/${namespace}/photos/${photo.id}`} alt="" style={{ width: 40, height: 40, objectFit: "contain" }} />}
                  <span>
                    <span className="chip-label">{specimen?.display_label ?? key}</span>
                    <span className="chip-sub">Sleeve {index + 1}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {manifest?.frozen && <p className="inline-note">{feedback("F_DISPATCH_FROZEN")}</p>}
      </div>
      <div className="panel" aria-label="Focused evidence">
        <h3>Evidence</h3>
        {focused && (
          <div className="fact-box">
            <h3>{state?.specimens[focused]?.display_label ?? focused}</h3>
            <p>Latest obverse photograph attached to the packing sleeve.</p>
          </div>
        )}
        <button className="btn btn-primary" aria-label="Review dispatch" disabled={!offer || manifest?.frozen} onClick={() => setReviewOpen(true)}>
          Review dispatch
        </button>
      </div>
      {reviewOpen && (
        <ReviewDialog
          title="Freeze dispatch evidence"
          summary={`Freeze the manifest in order ${current.join(", ")}. The evidence becomes immutable.`}
          onConfirm={() => void confirmFreeze()}
          onCancel={() => setReviewOpen(false)}
        />
      )}
    </div>
  );
}
