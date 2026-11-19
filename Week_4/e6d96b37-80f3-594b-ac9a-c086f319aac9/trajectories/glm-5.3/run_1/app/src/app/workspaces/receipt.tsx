import { useState } from "react";
import { ApiError, postForm, postJson, useDesk } from "../desk_context.js";
import { feedback } from "../feedback.js";
import { stageForResume } from "../resume.js";
import { ReviewDialog, useCommand } from "../review.js";

export function ReceiptWorkspace(): React.ReactElement {
  const desk = useDesk();
  const runCommand = useCommand();
  const state = desk.state;
  const namespace = desk.session?.namespace ?? "hollowmint";
  const isDealer = desk.session?.role === "dealer";
  const [matches, setMatches] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);

  const offerEntry = state
    ? Object.entries(state.offers).find(([, o]) => o.status === "dispatched" || o.status === "received" || o.status === "disputed")
    : undefined;
  const offerKey = offerEntry?.[0] ?? "";
  const offer = offerEntry?.[1];
  const party = isDealer ? "dealer" : "counterpart";
  const receiving = isDealer ? offer?.counterpart_items ?? [] : offer?.dealer_items ?? [];

  const arrivals = state
    ? Object.values(state.specimens).flatMap((s) => s.photos.filter((p) => p.label === "arrival").map((p) => ({ specimen: s, photo: p })))
    : [];

  const dispatchPhotos = state
    ? Object.values(state.specimens).flatMap((s) => s.photos.filter((p) => p.label === "dispatch").map((p) => ({ specimen: s, photo: p })))
    : [];

  const focused = receiving[0];
  const arrival = arrivals.find((a) => a.specimen.display_label === (state?.specimens[focused]?.display_label ?? "")) ?? arrivals[0];
  const dispatch = dispatchPhotos.find((d) => d.specimen.display_label === (state?.specimens[focused]?.display_label ?? "")) ?? dispatchPhotos[0];

  const uploadArrival = async (file: File | undefined, specimen: string) => {
    if (!file || !offer) return;
    const commandId = `arrival-${Date.now()}`;
    const form = new FormData();
    form.append("command_id", commandId);
    form.append("specimen", specimen);
    form.append("photo", file);
    try {
      await postForm(`/api/desks/${namespace}/offers/${offerKey}/arrivals`, form);
      await desk.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        desk.reportError(err.failure.body.message);
      }
    }
  };

  const confirmReceipt = async () => {
    const commandId = `receipt-${Date.now()}`;
    await runCommand(commandId, async () => {
      try {
        await postJson(`/api/desks/${namespace}/offers/${offerKey}/receipts`, {
          command_id: commandId,
          expected_version: offer?.version,
          matches,
        });
        desk.announce(matches ? feedback("F_RECEIPT_WAIT") : feedback("F_RECEIPT_MISMATCH"));
        setReviewOpen(false);
        await desk.refresh();
      } catch (err) {
        if (err instanceof ApiError) {
          const stepUpNeeded = err.failure.status === 403 && err.failure.body.error === "step_up_required";
          if (stepUpNeeded) {
            desk.reportError(feedback("F_MFA_REQUIRED"));
            setReviewOpen(false);
            stageForResume({
              path: `/api/desks/${namespace}/offers/${offerKey}/receipts`,
              method: "POST",
              commandId,
              body: { command_id: commandId, expected_version: offer?.version, matches },
            });
            window.location.href = `/auth/step-up?return_to=${encodeURIComponent(window.location.pathname)}`;
            return;
          }
          desk.reportError(err.failure.body.message);
          return;
        }
        throw err;
      }
    });
  };

  return (
    <div aria-label="Receipt workspace" className="workspace-two-col">
      <div className="panel" aria-label="Dispatch photo">
        <h3>Dispatch photograph</h3>
        {dispatch ? (
          <img
            className="viewer-image"
            style={{ position: "static", width: "100%", objectFit: "contain" }}
            src={`/api/desks/${namespace}/photos/${dispatch.photo.id}`}
            alt={`${dispatch.specimen.display_label} dispatch`}
          />
        ) : (
          <p>No dispatch photograph.</p>
        )}
      </div>
      <div className="panel" aria-label="Arrival">
        <h3>Arrival photograph</h3>
        {arrival ? (
          <div className="viewer" style={{ minHeight: 260 }}>
            <img
              className="viewer-image"
              src={`/api/desks/${namespace}/photos/${arrival.photo.id}`}
              alt={`${arrival.specimen.display_label} arrival`}
              style={{ transform: `scale(${zoom})` }}
            />
          </div>
        ) : (
          <p>No arrival photograph yet.</p>
        )}
        <div className="field">
          <label htmlFor="arrival-zoom">Arrival zoom:</label>
          <input
            id="arrival-zoom"
            type="range"
            min={1}
            max={4}
            step={0.25}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            aria-valuetext={`${zoom} times`}
          />
        </div>
        <button
          className="btn"
          aria-label="Arrival photo"
          onClick={() => document.getElementById("arrival-input")?.click()}
        >
          Arrival photo
        </button>
        <input
          id="arrival-input"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          hidden
          onChange={(e) => uploadArrival(e.target.files?.[0], uploadingFor ?? focused ?? "")}
        />
        <div className="field">
          <label>
            <input type="checkbox" checked={matches} onChange={(e) => setMatches(e.target.checked)} /> Manifest matches:
          </label>
        </div>
        <button className="btn btn-primary" aria-label="Review receipt" disabled={!offer} onClick={() => setReviewOpen(true)}>
          Review receipt
        </button>
      </div>
      {reviewOpen && offer && (
        <ReviewDialog
          title="Record receipt"
          summary={`Record ${matches ? "a matching" : "a mismatched"} receipt for ${offerKey}.`}
          onConfirm={() => void confirmReceipt()}
          onCancel={() => setReviewOpen(false)}
        />
      )}
    </div>
  );
}
