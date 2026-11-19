import { useState } from "react";
import { ApiError, postJson, useDesk } from "../desk_context.js";
import { feedback } from "../feedback.js";
import { stageForResume } from "../resume.js";
import { ReviewDialog, useCommand } from "../review.js";

export function OffersWorkspace(): React.ReactElement {
  const desk = useDesk();
  const runCommand = useCommand();
  const state = desk.state;
  const namespace = desk.session?.namespace ?? "hollowmint";
  const [dealerBasket, setDealerBasket] = useState<string[]>([]);
  const [counterpartBasket, setCounterpartBasket] = useState<string[]>([]);
  const [picked, setPicked] = useState<{ side: "dealer" | "counterpart"; key: string } | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);

  const dealerCandidates = state
    ? Object.entries(state.specimens).filter(
        ([, s]) =>
          s.owner === "dealer" &&
          s.attribution.register === "stored" &&
          s.attribution.certainty === "certain" &&
          !s.quarantined &&
          !s.missing &&
          s.status !== "reserved" &&
          s.status !== "outbound" &&
          s.status !== "transferred",
      )
    : [];
  const counterpartCandidates = state
    ? Object.entries(state.specimens).filter(
        ([, s]) =>
          s.owner === "counterpart" &&
          s.attribution.register === "stored" &&
          s.attribution.certainty === "certain" &&
          !s.quarantined &&
          !s.missing &&
          s.status !== "reserved" &&
          s.status !== "outbound" &&
          s.status !== "transferred",
      )
    : [];

  const draftOffer = state
    ? Object.entries(state.offers).find(([, o]) => o.status === "draft")
    : undefined;

  const stage = (side: "dealer" | "counterpart", key: string) => {
    if (side === "dealer") {
      setDealerBasket((prev) => (prev.includes(key) ? prev : [...prev, key].slice(0, 3)));
    } else {
      setCounterpartBasket((prev) => (prev.includes(key) ? prev : [...prev, key].slice(0, 3)));
    }
    setPicked(null);
  };

  const confirmSend = async () => {
    const commandId = `offer-send-${Date.now()}`;
    await runCommand(commandId, async () => {
      try {
        await postJson(`/api/desks/${namespace}/offers/${draftOffer?.[0] ?? "offer-1"}/send`, {
          command_id: commandId,
          expected_version: draftOffer?.[1].version,
          dealer_items: dealerBasket,
          counterpart_items: counterpartBasket,
        });
        desk.announce(feedback("F_OFFER_OK"));
        setReviewOpen(false);
        setDealerBasket([]);
        setCounterpartBasket([]);
        await desk.refresh();
      } catch (err) {
        if (err instanceof ApiError) {
          const stepUpNeeded = err.failure.status === 403 && err.failure.body.error === "step_up_required";
          if (stepUpNeeded) {
            desk.reportError(feedback("F_MFA_REQUIRED"));
            stageForResume({
              path: `/api/desks/${namespace}/offers/${draftOffer?.[0] ?? "offer-1"}/send`,
              method: "POST",
              commandId,
              body: {
                command_id: commandId,
                expected_version: draftOffer?.[1].version,
                dealer_items: dealerBasket,
                counterpart_items: counterpartBasket,
              },
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
    <div aria-label="Offer assembly workspace">
      <h2 className="desk-main-heading">Offer assembly</h2>
      <div className="workspace-two-col">
        <div className="panel">
          <h3>Dealer candidates</h3>
          {dealerCandidates.map(([key, s]) => (
            <button
              key={key}
              className="specimen-chip"
              aria-label={`Specimen ${key}`}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("text/plain", key);
                setPicked({ side: "dealer", key });
              }}
              onClick={() => stage("dealer", key)}
              onKeyDown={(e) => {
                if (e.key === " ") {
                  e.preventDefault();
                  setPicked({ side: "dealer", key });
                }
                if (e.key === "Escape") setPicked(null);
              }}
            >
              <span className="coin-disc">{s.attribution.mintmark}</span>
              <span>
                <span className="chip-label">{s.display_label}</span>
              </span>
            </button>
          ))}
          <div className="panel" style={{ marginTop: 10 }} aria-label="Dealer basket">
            <h3>Dealer basket</h3>
            {dealerBasket.length === 0 && <p>Empty</p>}
            {dealerBasket.map((key) => (
              <p key={key}>{state?.specimens[key]?.display_label}</p>
            ))}
          </div>
        </div>
        <div className="panel">
          <h3>Counterpart candidates</h3>
          {counterpartCandidates.map(([key, s]) => (
            <button
              key={key}
              className="specimen-chip"
              aria-label={`Specimen ${key}`}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("text/plain", key);
                setPicked({ side: "counterpart", key });
              }}
              onClick={() => stage("counterpart", key)}
              onKeyDown={(e) => {
                if (e.key === " ") {
                  e.preventDefault();
                  setPicked({ side: "counterpart", key });
                }
                if (e.key === "Escape") setPicked(null);
              }}
            >
              <span className="coin-disc">{s.attribution.mintmark}</span>
              <span>
                <span className="chip-label">{s.display_label}</span>
              </span>
            </button>
          ))}
          <div className="panel" style={{ marginTop: 10 }} aria-label="Counterpart basket">
            <h3>Counterpart basket</h3>
            {counterpartBasket.length === 0 && <p>Empty</p>}
            {counterpartBasket.map((key) => (
              <p key={key}>{state?.specimens[key]?.display_label}</p>
            ))}
          </div>
          <button className="btn btn-primary" aria-label="Review offer" onClick={() => setReviewOpen(true)}>
            Review offer
          </button>
        </div>
      </div>
      {reviewOpen && draftOffer && (
        <ReviewDialog
          title="Send reciprocal offer"
          summary={`Send ${dealerBasket.join(", ") || "no specimens"} for ${counterpartBasket.join(", ") || "no specimens"}.`}
          onConfirm={() => void confirmSend()}
          onCancel={() => setReviewOpen(false)}
        />
      )}
    </div>
  );
}
