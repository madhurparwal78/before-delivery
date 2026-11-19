import { useEffect, useState } from "react";
import { ApiError, postJson, useDesk } from "../desk_context.js";
import { feedback } from "../feedback.js";
import { stageForResume } from "../resume.js";
import { ReviewDialog, useCommand } from "../review.js";
import { windowFor } from "./shared.js";

export function CounteroffersWorkspace(): React.ReactElement {
  const desk = useDesk();
  const runCommand = useCommand();
  const state = desk.state;
  const namespace = desk.session?.namespace ?? "hollowmint";
  const [selectedOffer, setSelectedOffer] = useState<string>("");
  const [replaceReview, setReplaceReview] = useState(false);
  const [acceptReview, setAcceptReview] = useState(false);
  const [replaceCandidate, setReplaceCandidate] = useState<string>("");
  const [windowTick, setWindowTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setWindowTick((t) => t + 1), 60000);
    return () => clearInterval(timer);
  }, []);

  const offerKey = selectedOffer || Object.keys(state?.offers ?? {})[0] || "";
  const offer = state?.offers[offerKey];
  const isDealer = desk.session?.role === "dealer";

  const available = state
    ? Object.entries(state.specimens).filter(
        ([, s]) =>
          (isDealer ? s.owner === "dealer" : s.owner === "counterpart") &&
          s.attribution.register === "stored" &&
          !s.quarantined &&
          s.status !== "reserved" &&
          s.status !== "outbound" &&
          s.status !== "transferred",
      )
    : [];

  const confirmReplace = async (side: "dealer" | "counterpart") => {
    if (!offer) return;
    const commandId = `replace-${Date.now()}`;
    const ownItems = isDealer ? offer.dealer_items : offer.counterpart_items;
    const remove = ownItems[0];
    await runCommand(commandId, async () => {
      try {
        await postJson(`/api/desks/${namespace}/offers/${offerKey}/replace`, {
          command_id: commandId,
          expected_version: offer.version,
          remove,
          add: replaceCandidate,
        });
        desk.announce(feedback("F_COUNTER_VOID"));
        setReplaceReview(false);
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

  const confirmAccept = async () => {
    if (!offer) return;
    const commandId = `accept-${Date.now()}`;
    await runCommand(commandId, async () => {
      try {
        await postJson(`/api/desks/${namespace}/offers/${offerKey}/accept`, {
          command_id: commandId,
          expected_version: offer.version,
        });
        desk.announce(feedback("F_COUNTER_ACCEPT"));
        setAcceptReview(false);
        await desk.refresh();
      } catch (err) {
        if (err instanceof ApiError) {
          const stepUpNeeded = err.failure.status === 403 && err.failure.body.error === "step_up_required";
          if (stepUpNeeded) {
            desk.reportError(feedback("F_MFA_REQUIRED"));
            setAcceptReview(false);
            stageForResume({
              path: `/api/desks/${namespace}/offers/${offerKey}/accept`,
              method: "POST",
              commandId,
              body: { command_id: commandId, expected_version: offer.version },
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

  void windowTick;

  return (
    <div aria-label="Counteroffer workspace" className="workspace-two-col">
      <div className="panel">
        <h3>Offers</h3>
        {state &&
          Object.entries(state.offers).map(([key, o]) => (
            <button
              key={key}
              className={`specimen-chip${offerKey === key ? " picked" : ""}`}
              aria-label={`Offer ${key}`}
              onClick={() => setSelectedOffer(key)}
            >
              <span>
                <span className="chip-label">{key}</span>
                <span className="chip-sub">{o.status}</span>
              </span>
            </button>
          ))}
        <div className="panel" aria-label="Response window">
          <h3>Response window</h3>
          <p>{offer ? windowFor(offer) : "—"}</p>
        </div>
      </div>
      <div className="workspace-panes">
        <div className="panel" aria-label="Dealer side">
          <h3>Dealer side</h3>
          {offer?.dealer_items.map((key) => (
            <p key={key}>{state?.specimens[key]?.display_label ?? key}</p>
          ))}
        </div>
        <div className="panel" aria-label="Counterpart side">
          <h3>Counterpart side</h3>
          {offer?.counterpart_items.map((key) => (
            <p key={key}>{state?.specimens[key]?.display_label ?? key}</p>
          ))}
        </div>
        <div className="panel">
          <h3>Replace</h3>
          {available.map(([key, s]) => (
            <button key={key} className="specimen-chip" aria-label={`Specimen ${key}`} onClick={() => setReplaceCandidate(key)}>
              <span className="coin-disc">{s.attribution.mintmark}</span>
              <span className="chip-label">{s.display_label}</span>
            </button>
          ))}
          <button className="btn btn-primary" aria-label="Review replacement" disabled={!replaceCandidate || !offer} onClick={() => setReplaceReview(true)}>
            Review replacement
          </button>
        </div>
        <div className="panel">
          <h3>Acceptance</h3>
          <p>{offer ? `Version ${offer.version}, acceptances dealer ${offer.acceptances.dealer ?? "—"} / counterpart ${offer.acceptances.counterpart ?? "—"}` : "—"}</p>
          <button
            className="btn btn-primary"
            aria-label="Accept current offer"
            disabled={!offer}
            onClick={() => setAcceptReview(true)}
          >
            Accept current offer
          </button>
        </div>
      </div>
      {replaceReview && offer && (
        <ReviewDialog
          title="Replace offered specimen"
          summary={`Replace the first offered specimen with ${state?.specimens[replaceCandidate]?.display_label ?? replaceCandidate}. Both acceptances clear.`}
          onConfirm={() => void confirmReplace(isDealer ? "dealer" : "counterpart")}
          onCancel={() => setReplaceReview(false)}
        />
      )}
      {acceptReview && offer && (
        <ReviewDialog
          title="Accept offer version"
          summary={`Accept ${offerKey} at version ${offer.version}.`}
          extra={
            <button className="btn" aria-label="Verify acceptance" onClick={() => {
              window.location.href = `/auth/step-up?return_to=${encodeURIComponent(window.location.pathname)}`;
            }}>
              Verify acceptance
            </button>
          }
          onConfirm={() => void confirmAccept()}
          onCancel={() => setAcceptReview(false)}
        />
      )}
    </div>
  );
}
