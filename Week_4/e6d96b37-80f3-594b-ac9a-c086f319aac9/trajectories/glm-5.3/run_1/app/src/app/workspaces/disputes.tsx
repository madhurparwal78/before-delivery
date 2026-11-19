import { useState } from "react";
import { ApiError, deleteCall, postJson, useDesk } from "../desk_context.js";
import { feedback } from "../feedback.js";
import { ReviewDialog, useCommand } from "../review.js";

export function DisputesWorkspace(): React.ReactElement {
  const desk = useDesk();
  const runCommand = useCommand();
  const state = desk.state;
  const namespace = desk.session?.namespace ?? "hollowmint";
  const [openReview, setOpenReview] = useState(false);
  const [resolutionReview, setResolutionReview] = useState<null | "transfer" | "return">(null);
  const [marker, setMarker] = useState<{ x: number; y: number } | null>(null);
  const [note, setNote] = useState("");
  const [link, setLink] = useState<string | null>(null);

  const disputeEntry = state ? Object.entries(state.disputes).find(([, d]) => d.open) : undefined;
  const disputeKey = disputeEntry?.[0] ?? "";
  const dispute = disputeEntry?.[1];
  const disputedSpecimen = dispute ? state?.specimens[dispute.specimen] : undefined;
  const arrival = disputedSpecimen?.photos.find((p) => p.label === "arrival");

  const confirmOpen = async () => {
    if (!disputedSpecimen || !arrival || !dispute) return;
    const commandId = `dispute-${Date.now()}`;
    const offerEntry = state ? Object.entries(state.offers).find(([, o]) => o.status === "dispatched" || o.status === "received" || o.status === "disputed") : undefined;
    if (!offerEntry) return;
    await runCommand(commandId, async () => {
      try {
        await postJson(`/api/desks/${namespace}/offers/${offerEntry[0]}/disputes`, {
          command_id: commandId,
          expected_version: offerEntry[1].version,
          specimen: dispute.specimen,
          note,
          markers: marker ? [{ x: marker.x, y: marker.y, text: note }] : [],
        });
        desk.announce(feedback("F_DISPUTE_OPEN"));
        setOpenReview(false);
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

  const proposeResolution = async (outcome: "transfer" | "return") => {
    if (!dispute) return;
    const commandId = `resolution-${Date.now()}`;
    await runCommand(commandId, async () => {
      try {
        await postJson(`/api/desks/${namespace}/disputes/${disputeKey}/resolution`, {
          command_id: commandId,
          expected_version: dispute.version,
          outcome,
        });
        desk.announce(feedback("F_RESOLUTION_WAIT"));
        setResolutionReview(null);
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

  const approveResolution = async () => {
    if (!dispute) return;
    const commandId = `approve-${Date.now()}`;
    await runCommand(commandId, async () => {
      try {
        await postJson(`/api/desks/${namespace}/disputes/${disputeKey}/approve-resolution`, {
          command_id: commandId,
          expected_version: dispute.version,
        });
        desk.announce(feedback("F_RESOLUTION_DONE"));
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

  const createLink = async () => {
    if (!dispute) return;
    const commandId = `link-${Date.now()}`;
    await runCommand(commandId, async () => {
      try {
        const result = await postJson<{ link: { url: string; token: string } }>(`/api/desks/${namespace}/disputes/${disputeKey}/links`, {
          command_id: commandId,
        });
        setLink(result.link.url);
        desk.announce(feedback("F_LINK_COPIED"));
        await navigator.clipboard?.writeText(result.link.url).catch(() => undefined);
      } catch (err) {
        if (err instanceof ApiError) {
          desk.reportError(err.failure.body.message);
          return;
        }
        throw err;
      }
    });
  };

  const revokeLink = async () => {
    if (!dispute || !link) return;
    const token = link.split("/").pop() ?? "";
    await runCommand(`revoke-${Date.now()}`, async () => {
      try {
        await deleteCall(`/api/desks/${namespace}/disputes/${disputeKey}/links/${token}`);
        setLink(null);
        desk.announce(feedback("F_LINK_REVOKED"));
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
    <div aria-label="Dispute evidence workspace" className="workspace-two-col">
      <div className="panel" aria-label="Arrival evidence">
        <h3>Arrival evidence</h3>
        {arrival ? (
          <div className="viewer" style={{ minHeight: 280, position: "relative" }}>
            <img
              className="viewer-image"
              src={`/api/desks/${namespace}/photos/${arrival.id}`}
              alt={`${disputedSpecimen?.display_label} arrival`}
            />
            {marker && (
              <span
                style={{
                  position: "absolute",
                  left: `${(marker.x / (arrival.width || 1000)) * 100}%`,
                  top: `${(marker.y / (arrival.height || 1000)) * 100}%`,
                  width: 14,
                  height: 14,
                  marginLeft: -7,
                  marginTop: -7,
                  borderRadius: "50%",
                  background: "var(--amber)",
                  border: "2px solid #fff",
                }}
              />
            )}
          </div>
        ) : (
          <p>No arrival photograph.</p>
        )}
        <button className="btn" aria-label="Damage marker" onClick={() => setMarker({ x: 600, y: 400 })}>
          Damage marker
        </button>
        <div className="field">
          <label htmlFor="image-x">Image x:</label>
          <input
            id="image-x"
            type="number"
            value={marker?.x ?? ""}
            onChange={(e) => setMarker((m) => (m ? { ...m, x: Number(e.target.value) } : { x: Number(e.target.value), y: 400 }))}
          />
        </div>
        <div className="field">
          <label htmlFor="image-y">Image y:</label>
          <input
            id="image-y"
            type="number"
            value={marker?.y ?? ""}
            onChange={(e) => setMarker((m) => (m ? { ...m, y: Number(e.target.value) } : { x: 600, y: Number(e.target.value) }))}
          />
        </div>
      </div>
      <div className="panel" aria-label="Dispute details">
        <h3>Details</h3>
        <div className="field">
          <label htmlFor="damage-note">Damage note:</label>
          <textarea id="damage-note" rows={4} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <button className="btn btn-primary" aria-label="Review dispute" onClick={() => setOpenReview(true)}>
          Review dispute
        </button>
        {dispute && (
          <>
            <p>Dispute {disputeKey} on {state?.specimens[dispute.specimen]?.display_label} — {dispute.open ? "open" : "closed"}</p>
            <button className="btn" aria-label="Propose resolution" onClick={() => setResolutionReview("transfer")}>
              Propose resolution
            </button>{" "}
            <button className="btn" aria-label="Approve resolution" onClick={() => void approveResolution()}>
              Approve resolution
            </button>
          </>
        )}
        <button className="btn" aria-label="Copy private evidence link" onClick={() => void createLink()}>
          Copy private evidence link
        </button>{" "}
        {link && (
          <button className="btn" aria-label="Revoke evidence link" onClick={() => void revokeLink()}>
            Revoke evidence link
          </button>
        )}
        <button className="btn" aria-label="Open resolution review" onClick={() => setResolutionReview("return")}>
          Open resolution review
        </button>
      </div>
      {openReview && (
        <ReviewDialog
          title="Hold ownership transfer"
          summary={`Open a dispute on ${disputedSpecimen?.display_label ?? "the arrival"} with a damage marker${marker ? ` at (${marker.x}, ${marker.y})` : ""}.`}
          onConfirm={() => void confirmOpen()}
          onCancel={() => setOpenReview(false)}
        />
      )}
      {resolutionReview !== null && (
        <ReviewDialog
          title="Resolve transfer hold"
          summary={`Propose the resolution for ${disputeKey}.`}
          extra={
            <div className="field">
              <label>
                <input type="radio" name="outcome" checked={resolutionReview === "transfer"} onChange={() => setResolutionReview("transfer")} /> Transfer as agreed
              </label>
              <label>
                <input type="radio" name="outcome" checked={resolutionReview === "return"} onChange={() => setResolutionReview("return")} /> Return both baskets
              </label>
            </div>
          }
          onConfirm={() => void proposeResolution(resolutionReview)}
          onCancel={() => setResolutionReview(null)}
        />
      )}
    </div>
  );
}
