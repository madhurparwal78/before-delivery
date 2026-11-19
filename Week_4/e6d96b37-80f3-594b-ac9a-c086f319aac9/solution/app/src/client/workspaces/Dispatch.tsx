// Dispatch: order the packing manifest to match the physical sleeves, then freeze it through
// "Freeze dispatch evidence", which stores immutable copies of each item's latest obverse.
// Both the list and the phone sleeve sequence render the manifest's own order.

import { useState } from "react";
import { F } from "../../shared/feedback";
import { draftKey } from "../../shared/drafts";
import { jsonCommand } from "../commands";
import { useDesk } from "../desk";
import { useDraft } from "../drafts";
import { EmptyFacts, FactBoxes, label, useSelectedOffer, Workspace } from "../parts";
import { useReorder } from "../reorder";
import { Review } from "../Review";
import { CoinImage } from "../viewers";

/**
 * The evidence grid is fluid (145 to 229 CSS pixels at the published viewports). This width gives a copy no more than
 * 2.5 times the narrowest of those and about 1.6 times the widest.
 */
const EVIDENCE_WIDTH = 180;

export function Dispatch() {
  const { ns, state, session, send, announce, showError } = useDesk();
  const [offerKey] = useSelectedOffer(["accepted", "dispatched"]);
  const party = session?.role === "counterpart" ? "counterpart" : "dealer";
  const manifestKey = `${offerKey}/${party}`;
  const manifest = state?.manifests[manifestKey];
  const [staged, setStaged, clearStaged] = useDraft<string[] | null>(draftKey(ns, "dispatch", manifestKey), null);
  const [reviewing, setReviewing] = useState(false);
  const [focused, setFocused] = useState<string | null>(null);
  const saved = manifest?.order ?? [];
  const valid = !manifest?.frozen && staged !== null && staged.length === saved.length && staged.every((k) => saved.includes(k));
  const order = valid ? staged : saved;
  const { item } = useReorder({
    order,
    setOrder: setStaged,
    label,
    announce,
    refuse: () => {
      if (manifest?.frozen) showError(F.DISPATCH_FROZEN);
      return Boolean(manifest?.frozen);
    },
  });
  if (!state || !session) return null;
  if (!offerKey || !manifest) {
    return (
      <Workspace name="Dispatch workspace" heading="Dispatch" list="exchange" className="ws-dispatch">
        <EmptyFacts heading="Dispatch:" steps={["No accepted offer is waiting to be packed.", "Once both parties accept an offer, its packing manifest appears here."]} />
      </Workspace>
    );
  }
  const shown = focused && order.includes(focused) ? focused : (order[0] ?? null);
  const photoOf = (key: string, face: "obverse" | "reverse" | "dispatch") => state.specimens[key]?.photos.filter((p) => p.label === face).at(-1);

  return (
    <Workspace name="Dispatch workspace" heading={`Dispatch · ${offerKey}`} list="exchange" className="ws-dispatch" facts={shown && <FactBoxes specimenKey={shown} specimen={state.specimens[shown]} />}>
      <div className="area-manifest list-box">
        <p className="caption-text">{manifest.frozen ? "Frozen. This is the packing order in the sleeves." : "Order the items to match the packing sleeves, first sleeve at the top."}</p>
        <ol className="manifest" aria-label="Packing manifest">
          {order.map((key, index) => {
            const obverse = photoOf(key, "obverse");
            return (
              <li key={key} className="manifest-item sleeve">
                <span className="sleeve-number figures">Sleeve {index + 1}</span>
                <span className="manifest-photo">{obverse && <CoinImage photo={obverse} alt={`${label(key)} obverse`} displayWidth={64} />}</span>
                <button type="button" className="chip manifest-chip" onFocus={() => setFocused(key)} {...item(key)}>
                  <span className="sr-only">{`Manifest item ${key}`}</span>
                  <span className="chip-label" aria-hidden="true">{label(key)}</span>
                  <span className="chip-status" aria-hidden="true">{state.specimens[key]?.holder.kind}</span>
                </button>
              </li>
            );
          })}
        </ol>
        {valid && <p className="caption-text">Staged order, not frozen yet.</p>}
      </div>
      <div className="area-evidence evidence">
        {shown && (
          <>
            <h2 className="box-heading">{label(shown)} evidence:</h2>
            <div className="evidence-photos">
              {(["obverse", "reverse", "dispatch"] as const).map((face) => {
                const photo = photoOf(shown, face);
                return photo ? (
                  <figure key={face} className="evidence-photo">
                    <span className="photo-frame">
                      <CoinImage photo={photo} alt={`${label(shown)} ${face}`} displayWidth={EVIDENCE_WIDTH} />
                    </span>
                    <figcaption>{face === "dispatch" ? "Frozen dispatch copy" : face}</figcaption>
                  </figure>
                ) : null;
              })}
            </div>
          </>
        )}
      </div>
      <div className="area-review actions">
        <button type="button" className="button primary" onClick={() => setReviewing(true)}>
          Review dispatch
        </button>
      </div>
      {reviewing && (
        <Review
          label="Freeze dispatch evidence"
          onClose={() => setReviewing(false)}
          onConfirm={async () => {
            const outcome = await send(jsonCommand("freeze", "POST", `/offers/${offerKey}/manifests/${party}/freeze`, { expected_version: manifest.version, order }));
            if (outcome.ok) clearStaged();
            return "close";
          }}
          summary={
            <>
              <p>Freezes this packing order and stores an immutable copy of each item's latest obverse photograph.</p>
              <ol className="review-order">
                {order.map((key) => (
                  <li key={key}>{label(key)}</li>
                ))}
              </ol>
            </>
          }
        />
      )}
    </Workspace>
  );
}
