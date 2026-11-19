// Receipt: compare the arrival photograph with the frozen dispatch photograph at one shared scale,
// tick "Manifest matches" and record receipt through "Record receipt" with a fresh step-up.

import { Camera, ShieldCheck } from "lucide-react";
import { useRef, useState } from "react";
import { F } from "../../shared/feedback";
import { judgePhoto } from "../../shared/photoRules";
import { jsonCommand, newCommandId } from "../commands";
import { limits } from "../config";
import { type CommandRequest, useDesk } from "../desk";
import { EmptyFacts, FactBoxes, label, useSelectedOffer, Workspace } from "../parts";
import { Review } from "../Review";
import { CoinImage, useZoom, ZoomFrame, ZoomSlider } from "../viewers";

const FEATURE = { x: 0.6, y: 0.4 };

export function Receipt() {
  const { state, session, send, stepUp } = useDesk();
  const [offerKey, offer] = useSelectedOffer(["dispatched", "received", "disputed"]);
  const [matches, setMatches] = useState(false);
  const [file, setFile] = useState<{ name: string; bytes: Uint8Array; error: string | null } | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [needsStepUp, setNeedsStepUp] = useState<CommandRequest | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const { view, zoomAt, zoomTo } = useZoom(FEATURE);
  if (!state || !session) return null;
  const party = session.role === "counterpart" ? "counterpart" : "dealer";
  const received = offer ? (party === "dealer" ? offer.counterpart_items : offer.dealer_items) : [];
  if (!offerKey || !offer || received.length === 0) {
    return (
      <Workspace name="Receipt workspace" heading="Receipt" list="exchange" className="ws-receipt">
        <EmptyFacts heading="Receipt:" steps={["Nothing is on its way to you yet.", "Once both manifests are frozen, compare each arrival here."]} />
      </Workspace>
    );
  }
  const key = focused && received.includes(focused) ? focused : received[0]!;
  const specimen = state.specimens[key];
  const arrival = specimen?.photos.filter((p) => p.label === "arrival").at(-1);
  const dispatch = specimen?.photos.filter((p) => p.label === "dispatch").at(-1);
  const receipt = state.receipts[`${offerKey}/${party}`];

  const confirm = async () => {
    if (file && !file.error) {
      const form = new FormData();
      const commandId = newCommandId();
      form.set("command_id", commandId);
      form.set("specimen", key);
      form.set("photo", new Blob([file.bytes as BlobPart]), file.name);
      const saved = await send({ kind: "arrival", method: "POST", path: `/offers/${offerKey}/arrivals`, form, commandId });
      if (!saved.ok) return "close" as const;
      setFile(null);
    }
    const request = needsStepUp ?? jsonCommand("receipt", "POST", `/offers/${offerKey}/receipts`, { expected_version: offer.version, matches });
    const outcome = await send(request);
    if (outcome.ok === false && outcome.stepUp) {
      setNeedsStepUp(request);
      return "stay" as const;
    }
    setNeedsStepUp(null);
    return "close" as const;
  };

  return (
    <Workspace name="Receipt workspace" heading={`Receipt · ${offerKey}`} list="exchange" className="ws-receipt" facts={<FactBoxes specimenKey={key} specimen={specimen} />}>
      {received.length > 1 && (
        <div className="area-picker picker">
          {received.map((k) => (
            <button key={k} type="button" className={k === key ? "button quiet current" : "button quiet"} onClick={() => setFocused(k)}>
              Compare {label(k)}
            </button>
          ))}
        </div>
      )}
      <figure className="area-arrival viewer">
        <figcaption className="box-heading">Arrival photograph:</figcaption>
        <ZoomFrame view={view} zoomAt={zoomAt}>
          {arrival && <CoinImage photo={arrival} alt={`${label(key)} arrival`} />}
        </ZoomFrame>
        <ZoomSlider label="Arrival zoom" view={view} zoomTo={zoomTo} />
      </figure>
      <figure className="area-dispatch viewer">
        <figcaption className="box-heading">Frozen dispatch photograph:</figcaption>
        <ZoomFrame view={view} zoomAt={zoomAt} pinch={false}>
          {dispatch && <CoinImage photo={dispatch} alt={`${label(key)} dispatch`} />}
        </ZoomFrame>
      </figure>
      <div className="area-upload field">
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={async (e) => {
            const chosen = e.target.files?.[0];
            e.target.value = "";
            if (!chosen) return;
            const bytes = new Uint8Array(await chosen.arrayBuffer());
            const verdict = judgePhoto(bytes, limits);
            setFile({ name: chosen.name, bytes, error: verdict.ok ? null : verdict.copy });
          }}
        />
        <button type="button" className="button quiet" onClick={() => input.current?.click()}>
          <Camera aria-hidden="true" size={18} /> Arrival photo
        </button>
        {file && (file.error ? <p className="field-error">{file.error}</p> : <p className="caption-text">{`New arrival photograph ready: ${file.name}`}</p>)}
      </div>
      <div className="area-matches field checkbox-field">
        <input id="manifest-matches" type="checkbox" checked={matches} onChange={(e) => setMatches(e.target.checked)} />
        <label htmlFor="manifest-matches">Manifest matches</label>
      </div>
      <div className="area-review actions">
        <button type="button" className="button primary" onClick={() => setReviewing(true)}>
          Review receipt
        </button>
        {receipt && <p className="caption-text">{`You recorded receipt: ${receipt.matches ? "it matches the manifest" : "it does not match the manifest"}.`}</p>}
      </div>
      {reviewing && (
        <Review
          label="Record receipt"
          onClose={() => {
            setReviewing(false);
            setNeedsStepUp(null);
          }}
          onConfirm={confirm}
          summary={
            <p>
              Records your receipt of {received.map(label).join(", ")} for {offerKey}: the arrival <strong>{matches ? "matches" : "does not match"}</strong> the frozen manifest.
              {file && !file.error ? ` The new arrival photograph ${file.name} is saved first.` : ""}
            </p>
          }
        >
          {needsStepUp && (
            <div className="note step-up-note">
              <button type="button" className="action-link" onClick={() => stepUp(needsStepUp)}>
                <ShieldCheck aria-hidden="true" size={16} /> Verify identity
              </button>
              <p>{F.MFA_REQUIRED}</p>
            </div>
          )}
        </Review>
      )}
    </Workspace>
  );
}
