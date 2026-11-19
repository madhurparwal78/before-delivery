import { useState } from "react";
import { ApiError, postJson, useDesk } from "../desk_context.js";
import { feedback } from "../feedback.js";
import { ReviewDialog, useCommand } from "../review.js";

export function AttributionWorkspace(): React.ReactElement {
  const desk = useDesk();
  const runCommand = useCommand();
  const state = desk.state;
  const specimens = state ? Object.entries(state.specimens).filter(([, s]) => s.owner === "dealer") : [];
  const [selected, setSelected] = useState<string>(specimens[0]?.[0] ?? "");
  const [zoom, setZoom] = useState(1);
  const [note, setNote] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);
  const namespace = desk.session?.namespace ?? "hollowmint";

  const specimen = state?.specimens[selected];
  const photo = specimen?.photos.find((p) => p.label === "obverse");

  const onZoomKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    const target = event.target as HTMLInputElement;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      setZoom((z) => Math.min(4, z + 0.25));
    } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      setZoom((z) => Math.max(1, z - 0.25));
    } else if (event.key === "Home") {
      setZoom(1);
    } else if (event.key === "End") {
      setZoom(4);
    } else {
      setZoom(Number(target.value));
    }
  };

  const confirmQuarantine = async () => {
    const commandId = `quarantine-${Date.now()}`;
    await runCommand(commandId, async () => {
      try {
        await postJson(`/api/desks/${namespace}/specimens/${selected}/quarantine`, {
          command_id: commandId,
          expected_version: specimen?.version,
          note,
        });
        desk.announce(feedback("F_ATTR_OK"));
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
    <div aria-label="Attribution workspace" className="workspace-two-col">
      <div className="panel" aria-label="Stock grid">
        <h3>Stock</h3>
        {specimens.map(([key, s]) => (
          <button key={key} className="specimen-chip" aria-label={`Specimen ${key}`} onClick={() => setSelected(key)}>
            <span className="coin-disc">{s.attribution.mintmark || "?"}</span>
            <span>
              <span className="chip-label">{s.display_label}</span>
              <span className="chip-sub">{s.status}</span>
            </span>
          </button>
        ))}
      </div>
      <div className="workspace-panes">
        <div className="panel">
          <h3>Mintmark viewer</h3>
          <div className="viewer" style={{ minHeight: 320, position: "relative" }}>
            {photo ? (
              <img
                className="viewer-image"
                src={`/api/desks/${namespace}/photos/${photo.id}`}
                alt={`${specimen?.display_label} obverse`}
                style={{ transform: `scale(${zoom})`, transformOrigin: "center" }}
              />
            ) : null}
          </div>
          <div className="field">
            <label htmlFor="mintmark-zoom">Mintmark zoom:</label>
            <input
              id="mintmark-zoom"
              type="range"
              min={1}
              max={4}
              step={0.25}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              onKeyDown={onZoomKey}
              aria-valuetext={`${zoom} times`}
            />
          </div>
        </div>
        <div className="panel">
          <div className="fact-box" aria-label="Obverse facts">
            <h3>Obverse facts</h3>
            <p>{specimen ? `${specimen.display_label}, ${specimen.attribution.reference || "no record"}` : "—"}</p>
          </div>
          <div className="fact-box" aria-label="Reverse facts">
            <h3>Reverse facts</h3>
            <p>{specimen ? `Mintmark ${specimen.attribution.mintmark || "?"}` : "—"}</p>
          </div>
          <div className="field">
            <label htmlFor="attribution-note">Attribution note:</label>
            <textarea id="attribution-note" value={note} onChange={(e) => setNote(e.target.value)} rows={4} />
          </div>
          <button className="btn btn-primary" aria-label="Review quarantine" onClick={() => setReviewOpen(true)}>
            Review quarantine
          </button>
        </div>
      </div>
      {reviewOpen && specimen && (
        <ReviewDialog
          title="Quarantine attribution"
          summary={`Quarantine ${specimen.display_label}. It becomes ineligible for album holes and offers.`}
          onConfirm={() => void confirmQuarantine()}
          onCancel={() => setReviewOpen(false)}
        />
      )}
    </div>
  );
}
