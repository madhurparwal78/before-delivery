// Intake: drop each staged face photograph into its slot, type the specimen reference, and create
// the specimen only by confirming "Create specimen". Staged files live only in this tab.

import { ImagePlus } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { F } from "../../shared/feedback";
import { draftKey, type IntakeDraft } from "../../shared/drafts";
import { judgePhoto } from "../../shared/photoRules";
import { newCommandId } from "../commands";
import { limits } from "../config";
import { useDesk } from "../desk";
import { useDraft } from "../drafts";
import { useMoves } from "../moves";
import { FactBoxes, label, Workspace } from "../parts";
import { Review } from "../Review";

type Face = "obverse" | "reverse";

interface Staged {
  name: string;
  bytes: Uint8Array;
  url: string;
}

const FACES: Face[] = ["obverse", "reverse"];
const title = (face: Face) => (face === "obverse" ? "Obverse" : "Reverse");

async function stagedFrom(file: File): Promise<Staged> {
  return { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()), url: URL.createObjectURL(file) };
}

export function Intake() {
  const { ns, state, send } = useDesk();
  const [draft, setDraft] = useDraft<IntakeDraft>(draftKey(ns, "intake", "form"), { reference: "" });
  const [sources, setSources] = useState<Record<Face, Staged | null>>({ obverse: null, reverse: null });
  const [slots, setSlots] = useState<Record<Face, Staged | null>>({ obverse: null, reverse: null });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [reviewing, setReviewing] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const inputs = useRef<Record<Face, HTMLInputElement | null>>({ obverse: null, reverse: null });
  const heading = useRef<HTMLHeadingElement>(null);

  const moves = useMoves((source, destination) => {
    const [kind, face] = source.split(":") as ["src" | "slot", Face];
    const target = destination.split(":")[1] as Face;
    if (!destination.startsWith("slot:")) return;
    const moving = kind === "src" ? sources[face] : slots[face];
    if (!moving) return;
    const verdict = judgePhoto(moving.bytes, limits);
    if (!verdict.ok) {
      setErrors((e) => ({ ...e, [target]: verdict.copy }));
      return;
    }
    setErrors((e) => ({ ...e, [target]: "" }));
    if (kind === "slot") {
      setSlots((s) => ({ ...s, [face]: s[target], [target]: s[face] }));
    } else {
      const displaced = slots[target];
      setSlots((s) => ({ ...s, [target]: moving }));
      setSources((s) => ({ ...s, [face]: displaced }));
    }
  });

  useEffect(() => {
    if (created) heading.current?.focus();
  }, [created]);

  const stageFile = async (face: Face, file: File | undefined) => {
    if (!file) return;
    const staged = await stagedFrom(file);
    setSources((s) => ({ ...s, [face]: staged }));
  };

  const confirm = async () => {
    const form = new FormData();
    const commandId = newCommandId();
    form.set("command_id", commandId);
    form.set("reference", draft.reference);
    for (const face of FACES) {
      const staged = slots[face];
      if (staged) form.set(face, new Blob([staged.bytes as BlobPart]), staged.name);
    }
    const outcome = await send({ kind: "intake", method: "POST", path: "/specimens", form, commandId });
    if (outcome.ok) {
      setCreated(draft.reference);
      setSlots({ obverse: null, reverse: null });
      setErrors({});
      setDraft({ reference: "" });
    } else if (outcome.error?.fields) {
      setErrors(outcome.error.fields);
    }
    return "close" as const;
  };

  const createdSpecimen = created ? state?.specimens[created] : undefined;
  const factsKey = created ?? "A";

  return (
    <Workspace name="Intake workspace" heading="Intake" list="stock" className="ws-intake" facts={<FactBoxes specimenKey={factsKey} specimen={state?.specimens[factsKey]} />}>
      {FACES.map((face) => {
        const staged = sources[face];
        const slot = slots[face];
        const sourceProps = moves.source(`src:${face}`);
        return [
          <div key={`${face}-photo`} className={`area-${face}-photo staged-photo`}>
            <input
              ref={(el) => {
                inputs.current[face] = el;
              }}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(e) => {
                void stageFile(face, e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              className={staged ? "photo-source filled" : "photo-source"}
              {...sourceProps}
              aria-pressed={staged ? sourceProps["aria-pressed"] : undefined}
              onClick={(event) => (staged ? sourceProps.onClick(event) : inputs.current[face]?.click())}
              onKeyDown={(event) => staged && sourceProps.onKeyDown(event)}
              onDragOver={(event: DragEvent) => event.preventDefault()}
              onDrop={(event: DragEvent) => {
                event.preventDefault();
                void stageFile(face, event.dataTransfer.files[0]);
              }}
            >
              {staged ? <img src={staged.url} alt="" className="staged-thumb" draggable={false} /> : <ImagePlus aria-hidden="true" size={28} />}
              <span className="source-text">
                <strong>{title(face)} photo</strong>
                <span aria-hidden="true">{staged ? (sourceProps["aria-pressed"] ? "Picked up. Choose a slot." : staged.name) : "Choose or drop a photograph"}</span>
              </span>
            </button>
          </div>,
          <div key={`${face}-slot`} className={`area-${face}-slot slot-box`}>
            <button type="button" className={slot ? "photo-slot filled" : "photo-slot"} {...moves.source(`slot:${face}`, true)}>
              <span className="sr-only">{`${title(face)} slot`}</span>
              {slot ? <img src={slot.url} alt="" className="slot-photo" draggable={false} /> : <span className="slot-empty" aria-hidden="true">{title(face)} face goes here</span>}
            </button>
            {errors[face] && <p className="field-error slot-error">{errors[face]}</p>}
          </div>,
        ];
      })}
      <div className="area-reference field">
        <label htmlFor="specimen-reference">Specimen reference:</label>
        <input
          id="specimen-reference"
          aria-label="Specimen reference"
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={draft.reference}
          aria-invalid={Boolean(errors.reference)}
          aria-describedby={errors.reference ? "reference-error" : undefined}
          onChange={(e) => setDraft({ reference: e.target.value })}
        />
        {errors.reference && (
          <p id="reference-error" className="field-error">
            {errors.reference}
          </p>
        )}
      </div>
      <div className="area-review actions">
        <button type="button" className="button primary" onClick={() => setReviewing(true)}>
          Review intake
        </button>
      </div>
      {created && (
        <section className="area-created created" aria-label="Created specimen">
          <h2 ref={heading} tabIndex={-1}>
            {label(created)}
          </h2>
          <p>{createdSpecimen?.attribution.register === "pending" ? "Both photographs are stored. The specimen is waiting for its catalog record." : "Both photographs are stored."}</p>
        </section>
      )}
      {reviewing && (
        <Review
          label="Create specimen"
          onClose={() => setReviewing(false)}
          onConfirm={confirm}
          focusAfter={() => heading.current}
          summary={
            <>
              <p>
                Creates <strong>{label(draft.reference || "without a reference")}</strong> with both face photographs. It then waits for its catalog record.
              </p>
              <ul className="review-faces">
                {FACES.map((face) => (
                  <li key={face}>
                    <strong>{title(face)}:</strong> {slots[face] ? `${slots[face]!.name}, ${slots[face]!.bytes.length} bytes` : F.PHOTO_MISSING}
                  </li>
                ))}
              </ul>
            </>
          }
        />
      )}
    </Workspace>
  );
}
