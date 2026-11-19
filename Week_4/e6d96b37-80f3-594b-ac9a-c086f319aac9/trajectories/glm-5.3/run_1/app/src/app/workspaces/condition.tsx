import { useState } from "react";
import { ApiError, postJson, useDesk } from "../desk_context.js";
import { feedback } from "../feedback.js";
import { ReviewDialog, useCommand } from "../review.js";
import { WipeComparison } from "./reconciliation.js";

export function ConditionWorkspace(): React.ReactElement {
  const desk = useDesk();
  const runCommand = useCommand();
  const state = desk.state;
  const namespace = desk.session?.namespace ?? "hollowmint";
  const specimens = state ? Object.entries(state.specimens).filter(([, s]) => s.owner === "dealer") : [];
  const [selected, setSelected] = useState<string>(specimens[0]?.[0] ?? "");
  const [marker, setMarker] = useState<{ x: number; y: number } | null>(null);
  const [note, setNote] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);

  const specimen = state?.specimens[selected];
  const obverse = specimen?.photos.find((p) => p.label === "obverse");
  const arrival = specimen?.photos.find((p) => p.label === "arrival");

  const width = obverse?.width ?? 1000;
  const height = obverse?.height ?? 1000;

  const setMarkerFromImage = (x: number, y: number) => {
    setMarker({ x: Math.max(0, Math.min(width - 1, Math.floor(x))), y: Math.max(0, Math.min(height - 1, Math.floor(y))) });
  };

  const confirmSave = async () => {
    if (!marker) return;
    const commandId = `annotation-${Date.now()}`;
    await runCommand(commandId, async () => {
      try {
        await postJson(`/api/desks/${namespace}/specimens/${selected}/annotations`, {
          command_id: commandId,
          expected_version: specimen?.version,
          annotation: "condition",
          photo: obverse?.label ?? "obverse",
          x: marker.x,
          y: marker.y,
          text: note,
        });
        desk.announce(feedback("F_CONDITION_OK"));
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

  return (
    <div aria-label="Condition comparison workspace" className="workspace-two-col">
      <div className="panel" aria-label="Stock grid">
        <h3>Stock</h3>
        {specimens.map(([key, s]) => (
          <button key={key} className="specimen-chip" aria-label={`Specimen ${key}`} onClick={() => setSelected(key)}>
            <span className="coin-disc">{s.attribution.mintmark || "?"}</span>
            <span>
              <span className="chip-label">{s.display_label}</span>
            </span>
          </button>
        ))}
      </div>
      <div className="workspace-panes">
        <div className="panel">
          {obverse && (
            <WipeComparison
              first="Obverse"
              firstAlt={`${specimen?.display_label} obverse`}
              second="Arrival"
              secondAlt={`${specimen?.display_label} arrival`}
              storageKey={`${namespace}:${selected}:condition`}
              firstUrl={`/api/desks/${namespace}/photos/${obverse.id}`}
              secondUrl={arrival ? `/api/desks/${namespace}/photos/${arrival.id}` : `/api/desks/${namespace}/photos/${obverse.id}`}
            />
          )}
          <div className="field">
            <label htmlFor="condition-wipe">Condition wipe:</label>
            <input id="condition-wipe" type="range" min={0} max={100} defaultValue={0} aria-label="Condition wipe" />
          </div>
          <button className="btn" aria-label="Condition marker" onClick={() => setMarker({ x: 600, y: 400 })}>
            Condition marker
          </button>
        </div>
        <div className="panel">
          <div className="field">
            <label htmlFor="image-x">Image x:</label>
            <input
              id="image-x"
              type="number"
              value={marker?.x ?? ""}
              onChange={(e) => setMarker((m) => (m ? { ...m, x: Math.max(0, Math.min(width - 1, Number(e.target.value))) } : { x: Math.floor(Number(e.target.value)), y: 400 }))}
            />
          </div>
          <div className="field">
            <label htmlFor="image-y">Image y:</label>
            <input
              id="image-y"
              type="number"
              value={marker?.y ?? ""}
              onChange={(e) => setMarker((m) => (m ? { ...m, y: Math.max(0, Math.min(height - 1, Number(e.target.value))) } : { x: 600, y: Math.floor(Number(e.target.value)) }))}
            />
          </div>
          <div className="field">
            <label htmlFor="condition-note">Condition note:</label>
            <textarea id="condition-note" rows={4} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <button className="btn btn-primary" aria-label="Review condition note" onClick={() => setReviewOpen(true)}>
            Review condition note
          </button>
        </div>
      </div>
      {reviewOpen && specimen && marker && (
        <ReviewDialog
          title="Save condition note"
          summary={`Save a condition note at (${marker.x}, ${marker.y}) on ${specimen.display_label}.`}
          onConfirm={() => void confirmSave()}
          onCancel={() => setReviewOpen(false)}
        />
      )}
    </div>
  );
}
