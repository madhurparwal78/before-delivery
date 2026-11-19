// Counteroffers: either party replaces an offered specimen through "Replace offered specimen" and
// accepts the current version only after Keycloak's one-time-code challenge. A counterpart's staged
// replacement places a review hold on the dealer's duplicate it adds.

import { ShieldCheck } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { windowText } from "../../shared/counts";
import { F } from "../../shared/feedback";
import type { Offer, Party, Specimen } from "../../shared/types";
import { jsonCommand, newCommandId } from "../commands";
import { limits, reducedMotion } from "../config";
import { reopenKey, useDesk } from "../desk";
import { readDraft, writeDraft } from "../drafts";
import { useMoves } from "../moves";
import { CoinDisc, EmptyFacts, FactBoxes, label, useSelectedOffer, Workspace } from "../parts";
import { Review } from "../Review";
import { CoinImage } from "../viewers";

const UNAVAILABLE: readonly Specimen["status"][] = ["reserved", "outbound", "transferred", "missing", "quarantined"];

interface Staged {
  remove: string;
  add: string;
}

/** One offered slot; when its specimen is replaced only this slot's image fades out and the new one in. */
function OfferSlot({ specimen, staged, moves }: { specimen: string; staged: string | null; moves: ReturnType<typeof useMoves> }) {
  const { state } = useDesk();
  const [shown, setShown] = useState(specimen);
  const frame = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (specimen === shown) return;
    const element = frame.current;
    const duration = reducedMotion() ? 0 : limits.FLAN_MOTION_MS;
    if (!element || duration === 0) {
      setShown(specimen);
      return;
    }
    const out = element.animate([{ opacity: 1 }, { opacity: 0 }], { duration, easing: "linear", fill: "forwards" });
    out.onfinish = () => {
      setShown(specimen);
      element.animate([{ opacity: 0 }, { opacity: 1 }], { duration, easing: "linear", fill: "forwards" });
    };
  }, [specimen, shown]);
  const photo = state?.specimens[shown]?.photos.filter((p) => p.label === "obverse").at(-1);
  return (
    <figure className="slot-figure">
      <span ref={frame} className="slot-photo-frame">
        {photo && <CoinImage photo={photo} alt={`${label(shown)} obverse`} displayWidth={120} />}
      </span>
      <button type="button" className="chip slot-chip" {...moves.destination(`slot:${specimen}`)}>
        <span className="chip-label">{label(specimen)}</span>
        {staged && <span className="chip-status" aria-hidden="true">{`${label(staged)} staged in`}</span>}
      </button>
    </figure>
  );
}

export function Counteroffers() {
  const { ns, state, session, send, stepUp } = useDesk();
  const [offerKey, offer] = useSelectedOffer(["sent", "countered", "accepted"]);
  const [staged, setStaged] = useState<Staged | null>(null);
  const [dialog, setDialog] = useState<"replace" | "accept" | null>(null);
  const party = session?.role === "counterpart" ? "counterpart" : "dealer";

  const hold = async (add: string, previous: string | null) => {
    if (party !== "counterpart" || !offerKey) return;
    if (previous && previous !== add && state?.specimens[previous]?.owner === "dealer") {
      await send({ kind: "release", method: "DELETE", path: `/offers/${offerKey}/holds/${encodeURIComponent(previous)}`, commandId: newCommandId() });
    }
    if (state?.specimens[add]?.owner === "dealer" && !offer?.holds.includes(add)) {
      await send(jsonCommand("hold", "POST", `/offers/${offerKey}/holds`, { specimen: add }));
    }
  };

  const moves = useMoves((source, destination) => {
    const remove = destination.slice("slot:".length);
    if (state?.specimens[source]?.owner !== state?.specimens[remove]?.owner) return;
    const previous = staged?.add ?? null;
    setStaged({ remove, add: source });
    void hold(source, previous);
  });

  useEffect(() => {
    if (!offerKey || readDraft<string | null>(reopenKey(ns), null) !== `accept:${offerKey}`) return;
    writeDraft(reopenKey(ns), null);
    setDialog("accept");
  }, [ns, offerKey]);

  if (!state || !session) return null;
  if (!offerKey || !offer) {
    return (
      <Workspace name="Counteroffer workspace" heading="Counteroffers" list="exchange" className="ws-counter">
        <EmptyFacts heading="Counteroffers:" steps={["No offer is open for review.", "An offer sent by the dealer appears here."]} />
      </Workspace>
    );
  }

  const side = (who: Party, current: Offer) => {
    const items = who === "dealer" ? current.dealer_items : current.counterpart_items;
    const pool = Object.entries(state.specimens).filter(
      ([key, s]) => s.owner === who && !items.includes(key) && (UNAVAILABLE.includes(s.status) ? current.holds.includes(key) : true),
    );
    return (
      <section className={`basket basket-${who}`} aria-label={who === "dealer" ? "Dealer side" : "Counterpart side"}>
        <h2 className="basket-heading">
          {who === "dealer" ? "Dealer side" : "Counterpart side"}
          <span className="basket-sub">{who === "dealer" ? "Halloway Numismatics gives" : "Marsh & Tallow Coins gives"}</span>
        </h2>
        {pool.length > 0 && (
          <div className="swap-pool">
            <h3 className="box-heading">Swap in:</h3>
            <ul className="chips">
              {pool.map(([key, s]) => (
                <li key={key}>
                  <button type="button" className="chip" {...moves.source(key)}>
                    <CoinDisc mintmark={s.attribution.mintmark} />
                    <span className="chip-label">{label(key)}</span>
                    {current.holds.includes(key) && <span className="chip-status" aria-hidden="true">Held for review</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <ul className="basket-items">
          {items.map((key, index) => (
            <li key={index} className="basket-item">
              <OfferSlot specimen={key} staged={staged?.remove === key ? staged.add : null} moves={moves} />
            </li>
          ))}
          {items.length === 0 && <li className="basket-empty">Nothing on this side.</li>}
        </ul>
      </section>
    );
  };

  const accepted = offer.acceptances[party] === offer.version;
  return (
    <Workspace
      name="Counteroffer workspace"
      heading={`Counteroffers · ${offerKey}`}
      list="exchange"
      className="ws-counter"
      facts={offer.dealer_items[0] && <FactBoxes specimenKey={offer.dealer_items[0]} specimen={state.specimens[offer.dealer_items[0]]} />}
    >
      <section className="area-window window-box" aria-label="Response window">
        <p className="figures">
          <strong>Version {offer.version}</strong> · {offer.status}
        </p>
        <p className="figures window-text">{windowText(offer) ?? "No response window applies."}</p>
        {/* One line per party, so clearing an acceptance never rewraps the box and moves the baskets. */}
        <p className="caption-text">Dealer {offer.acceptances.dealer === offer.version ? "accepted this version" : "has not accepted this version"}.</p>
        <p className="caption-text">Counterpart {offer.acceptances.counterpart === offer.version ? "accepted this version" : "has not accepted this version"}.</p>
      </section>
      <div className="area-dealer-side">{side("dealer", offer)}</div>
      <div className="area-counterpart-side">{side("counterpart", offer)}</div>
      <div className="area-replace actions">
        <button type="button" className="button quiet" onClick={() => setDialog("replace")}>
          Review replacement
        </button>
      </div>
      <div className="area-accept actions">
        <button type="button" className="button primary" onClick={() => setDialog("accept")}>
          Accept current offer
        </button>
      </div>
      {dialog === "replace" && (
        <Review
          label="Replace offered specimen"
          onClose={() => setDialog(null)}
          confirmDisabled={!staged}
          onConfirm={async () => {
            const outcome = await send(jsonCommand("replace", "POST", `/offers/${offerKey}/replace`, { expected_version: offer.version, remove: staged!.remove, add: staged!.add }));
            if (outcome.ok) setStaged(null);
            return "close";
          }}
          summary={
            staged ? (
              <p>
                Replaces <strong>{label(staged.remove)}</strong> with <strong>{label(staged.add)}</strong> in {offerKey}. Both acceptances are cleared.
              </p>
            ) : (
              <p>No replacement is staged. Move a specimen onto an offered specimen first.</p>
            )
          }
        />
      )}
      {dialog === "accept" && (
        <Review
          label="Accept offer version"
          onClose={() => setDialog(null)}
          confirmDisabled={!session.step_up_fresh || accepted}
          onConfirm={async () => {
            await send(jsonCommand("accept", "POST", `/offers/${offerKey}/accept`, { expected_version: offer.version }));
            return "close";
          }}
          summary={
            <>
              <p>
                Accepts version <span className="figures">{offer.version}</span> of {offerKey}.
              </p>
              <div className="review-baskets">
                <section className="review-basket">
                  <h3>Dealer basket</h3>
                  <p>{`${offer.dealer_items.map(label).join(", ") || "Nothing"}.`}</p>
                </section>
                <section className="review-basket">
                  <h3>Counterpart basket</h3>
                  <p>{`${offer.counterpart_items.map(label).join(", ") || "Nothing"}.`}</p>
                </section>
              </div>
            </>
          }
        >
          {!session.step_up_fresh && (
            <div className="note step-up-note">
              <button type="button" className="action-link" onClick={() => stepUp(null, `accept:${offerKey}`)}>
                <ShieldCheck aria-hidden="true" size={16} /> Verify acceptance
              </button>
              <p>{F.MFA_REQUIRED}</p>
            </div>
          )}
        </Review>
      )}
    </Workspace>
  );
}
