// Condition comparison: wipe between the obverse and an arrival photograph, pin the scratch with
// the condition marker in original-image coordinates and save a condition note.

import { useState } from "react";
import { textLong } from "../../shared/feedback";
import { characters } from "../../shared/textRules";
import { draftKey, type MarkerDraft } from "../../shared/drafts";
import { jsonCommand } from "../commands";
import { limits } from "../config";
import { useDesk } from "../desk";
import { useDraft } from "../drafts";
import { EmptyFacts, FactBoxes, label, useSelectedSpecimen, Workspace } from "../parts";
import { Review } from "../Review";
import { Caption, CoinImage, CoordinateFields, Marker, project, Wipe } from "../viewers";

export function Condition() {
  const { ns, send, revoked } = useDesk();
  const [key, specimen] = useSelectedSpecimen();
  const [divider, setDivider] = useDraft<number>(draftKey(ns, "divider", `condition:${key ?? "none"}`), 50);
  const [draft, setDraft] = useDraft<MarkerDraft>(draftKey(ns, "condition", key ?? "none"), { note: "", x: 500, y: 500 });
  const [reviewing, setReviewing] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!key || !specimen) {
    return (
      <Workspace name="Condition comparison workspace" heading="Condition comparison" list="stock" className="ws-condition">
        <EmptyFacts heading="Condition comparison:" steps={["No specimen is on the desk yet.", "Take one in at Intake first."]} />
      </Workspace>
    );
  }
  const obverse = specimen.photos.filter((p) => p.label === "obverse").at(-1);
  const arrival = specimen.photos.filter((p) => p.label === "arrival").at(-1);
  const image = arrival ?? obverse;
  const saved = specimen.annotations.filter((a) => a.photo === arrival?.id);
  const tooLong = characters(draft.note) > limits.FLAN_NOTE_MAX_CHARS;

  const confirm = async () => {
    const annotation = draft.annotation ?? crypto.randomUUID();
    const outcome = await send(
      jsonCommand("annotation", "POST", `/specimens/${encodeURIComponent(key)}/annotations`, {
        expected_version: specimen.version,
        annotation,
        photo: arrival?.id ?? obverse?.id,
        x: draft.x,
        y: draft.y,
        text: draft.note,
      }),
    );
    if (outcome.ok) setDraft((d) => ({ ...d, annotation }));
    return "close" as const;
  };

  return (
    <Workspace name="Condition comparison workspace" heading={`Condition comparison · ${label(key)}`} list="stock" className="ws-condition" facts={<FactBoxes specimenKey={key} specimen={specimen} />}>
      <div className="area-viewer viewer">
        <Wipe
          tabs={["Obverse", "Arrival"]}
          sliderLabel="Condition wipe"
          value={divider}
          onChange={setDivider}
          first={obverse && <CoinImage photo={obverse} alt={`${label(key)} obverse`} />}
          second={arrival && <CoinImage photo={arrival} alt={`${label(key)} arrival`} onState={setFailed} />}
          overlay={(frame) =>
            image && !failed && !revoked && (
              <>
                {saved.map((a) => {
                  const at = project(frame, image, a.x, a.y);
                  return (
                    <Caption key={a.id} visible={(a.x / image.width) * 100 < divider} left={at.left} top={at.top}>
                      {a.text}
                    </Caption>
                  );
                })}
                <Marker label="Condition marker" point={draft} image={image} frame={frame} onMove={(p) => setDraft((d) => ({ ...d, ...p }))} />
              </>
            )
          }
        />
        {!arrival && <p className="caption-text">No arrival photograph yet; the marker sits on the obverse.</p>}
      </div>
      <div className="area-coords">
        {image && <CoordinateFields point={draft} image={image} onSet={(p) => setDraft((d) => ({ ...d, ...p }))} />}
      </div>
      <div className="area-note field">
        <label htmlFor="condition-note">Condition note:</label>
        <textarea
          id="condition-note"
          aria-label="Condition note"
          rows={4}
          value={draft.note}
          aria-invalid={tooLong}
          aria-describedby={tooLong ? "condition-note-error" : undefined}
          onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
        />
        {tooLong && (
          <p id="condition-note-error" className="field-error">
            {textLong(limits.FLAN_NOTE_MAX_CHARS)}
          </p>
        )}
      </div>
      <div className="area-review actions">
        <button type="button" className="button primary" onClick={() => setReviewing(true)}>
          Review condition note
        </button>
      </div>
      {reviewing && (
        <Review
          label="Save condition note"
          onClose={() => setReviewing(false)}
          onConfirm={confirm}
          summary={
            <>
              <p>
                Saves a condition note on the original {arrival ? "arrival" : "obverse"} photograph of <strong>{label(key)}</strong> at image point{" "}
                <span className="figures">
                  ({draft.x}, {draft.y})
                </span>
                .
              </p>
              <p>
                <strong>Note:</strong> {draft.note || "No note written."}
              </p>
            </>
          }
        />
      )}
    </Workspace>
  );
}
