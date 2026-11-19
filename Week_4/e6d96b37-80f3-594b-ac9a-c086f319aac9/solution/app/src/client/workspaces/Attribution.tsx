// Attribution: zoom into the mintmark, write a note and quarantine a doubtful attribution.

import { useState } from "react";
import { textLong } from "../../shared/feedback";
import { characters } from "../../shared/textRules";
import { draftKey } from "../../shared/drafts";
import { jsonCommand } from "../commands";
import { limits } from "../config";
import { useDesk } from "../desk";
import { useDraft } from "../drafts";
import { EmptyFacts, FactBoxes, label, useSelectedSpecimen, Workspace } from "../parts";
import { Review } from "../Review";
import { CoinImage, useZoom, ZoomFrame, ZoomSlider } from "../viewers";

const MINTMARK = { x: 0.6, y: 0.4 };

export function Attribution() {
  const { ns, send } = useDesk();
  const [key, specimen] = useSelectedSpecimen();
  const [note, setNote] = useDraft<string>(draftKey(ns, "attribution", key ?? "none"), "");
  const [reviewing, setReviewing] = useState(false);
  const { view, zoomAt, zoomTo } = useZoom(MINTMARK);
  const obverse = specimen?.photos.filter((p) => p.label === "obverse").at(-1);
  const tooLong = characters(note) > limits.FLAN_NOTE_MAX_CHARS;

  const confirm = async () => {
    await send(jsonCommand("quarantine", "POST", `/specimens/${encodeURIComponent(key!)}/quarantine`, { expected_version: specimen!.version, note }));
    return "close" as const;
  };

  if (!key || !specimen) {
    return (
      <Workspace name="Attribution workspace" heading="Attribution" list="stock" className="ws-attribution">
        <EmptyFacts heading="Attribution:" steps={["No specimen is on the desk yet.", "Take one in at Intake, then attribute it here."]} />
      </Workspace>
    );
  }

  return (
    <Workspace name="Attribution workspace" heading={`Attribution · ${label(key)}`} list="stock" className="ws-attribution">
      <div className="area-viewer viewer">
        <ZoomFrame view={view} zoomAt={zoomAt}>
          {obverse && <CoinImage photo={obverse} alt={`${label(key)} obverse`} />}
        </ZoomFrame>
        <ZoomSlider label="Mintmark zoom" view={view} zoomTo={zoomTo} />
        <p className="caption-text">
          {specimen.attribution.register === "stored"
            ? `Register ${specimen.attribution.reference}, mintmark ${specimen.attribution.mintmark}.`
            : `Mintmark ${specimen.attribution.mintmark ?? "not read"}; the catalog record is still pending.`}
        </p>
      </div>
      <div className="area-facts">
        <FactBoxes specimenKey={key} specimen={specimen} />
      </div>
      <div className="area-note field">
        <label htmlFor="attribution-note">Attribution note:</label>
        <textarea
          id="attribution-note"
          aria-label="Attribution note"
          rows={4}
          value={note}
          aria-invalid={tooLong}
          aria-describedby={tooLong ? "attribution-note-error" : undefined}
          onChange={(e) => setNote(e.target.value)}
        />
        {tooLong && (
          <p id="attribution-note-error" className="field-error">
            {textLong(limits.FLAN_NOTE_MAX_CHARS)}
          </p>
        )}
      </div>
      <div className="area-review actions">
        <button type="button" className="button primary" onClick={() => setReviewing(true)}>
          Review quarantine
        </button>
      </div>
      {reviewing && (
        <Review
          label="Quarantine attribution"
          onClose={() => setReviewing(false)}
          onConfirm={confirm}
          summary={
            <>
              <p>
                Quarantines the attribution of <strong>{label(key)}</strong>. While quarantined it cannot fill album holes or go into offers.
              </p>
              <p>
                <strong>Note:</strong> {note || "No note written."}
              </p>
            </>
          }
        />
      )}
    </Workspace>
  );
}
