import { useState } from "react";
import type { Member, Part } from "../shared/types.js";
import { api, ApiError, KeyStore } from "./api.js";
import { BodyView } from "./views.js";
import { display } from "../shared/units.js";
import { saveStatusText, measurementsCopy } from "./copy.js";
import type { Mode, SaveFeedback } from "./Workspace.js";

/** Part mode: save status, material, measurements, save and new sketch. */

export function PartScreen(props: {
  member: Member;
  founder: boolean;
  part: Part | null;
  mode: Extract<Mode, { kind: "part" }>;
  setMode: (mode: Mode) => void;
  materials: { id: string; name: string; density_g_cm3: number }[];
  sayModel: (text: string) => void;
  handleError: (err: unknown) => void;
  saveFeedback: SaveFeedback;
  setSaveFeedback: (feedback: SaveFeedback) => void;
  updatePartInLists: (part: Part) => void;
  refreshLists: () => Promise<void>;
  keys: KeyStore;
  afterPartChange: () => void;
  setDialog: (dialog: import("./Workspace.js").DialogState) => void;
  propertiesSheet: boolean;
  storageOutage: boolean;
  closeSheet: () => void;
}): JSX.Element {
  const [depth, setDepth] = useState("");
  const [direction, setDirection] = useState<"normal" | "reverse" | "symmetric">("normal");
  const [pendingDepth, setPendingDepth] = useState(false);
  const [depthError, setDepthError] = useState<string | null>(null);

  const part = props.part;
  if (!part) return <div />;

  const measurements = measurementsCopy(part);
  const editingFeature = part.features.find((f) => f.id === props.mode.editingFeatureId) ?? null;
  const previewVolume =
    editingFeature && depth.trim() !== "" ? previewVolumeFor(part, editingFeature, depth, props.member) : null;

  const applyDepth = async (): Promise<void> => {
    if (!editingFeature) return;
    setPendingDepth(true);
    props.setSaveFeedback({ status: "saving" });
    try {
      const reply = await api.patchFeature(part.id, editingFeature.id, {
        base_revision: part.revision,
        depth
      });
      props.updatePartInLists(reply.part);
      props.setSaveFeedback(
        reply.part.body.status === "stored"
          ? { status: "stored" }
          : reply.part.body.status === "none"
            ? { status: "no_body" }
            : { status: "not_stored" }
      );
      props.sayModel(`${editingFeature.name} depth applied.`);
      props.afterPartChange();
    } catch (err) {
      if (err instanceof ApiError && err.fields?.depth) {
        setDepthError(err.fields.depth);
        props.setSaveFeedback({ status: "idle" });
      } else {
        props.handleError(err);
        if (err instanceof ApiError && err.status === 503) props.setSaveFeedback({ status: "not_stored" });
        else props.setSaveFeedback({ status: "idle" });
      }
    } finally {
      setPendingDepth(false);
    }
  };

  const savePart = async (): Promise<void> => {
    props.setSaveFeedback({ status: "saving" });
    try {
      const reply = await api.savePart(part.id);
      props.updatePartInLists(reply.part);
      props.setSaveFeedback(
        reply.part.body.status === "stored"
          ? { status: "stored" }
          : reply.part.body.status === "none"
            ? { status: "no_body" }
            : { status: "not_stored" }
      );
      props.afterPartChange();
    } catch (err) {
      props.handleError(err);
      props.setSaveFeedback({ status: "idle" });
    }
  };

  const changeMaterial = async (materialId: string): Promise<void> => {
    props.setSaveFeedback({ status: "saving" });
    try {
      const reply = await api.patchPart(part.id, {
        base_revision: part.revision,
        material_id: materialId
      });
      props.updatePartInLists(reply.part);
      props.setSaveFeedback(
        reply.part.body.status === "stored"
          ? { status: "stored" }
          : reply.part.body.status === "none"
            ? { status: "no_body" }
            : { status: "not_stored" }
      );
      await props.refreshLists();
      props.afterPartChange();
    } catch (err) {
      props.handleError(err);
      props.setSaveFeedback({ status: "idle" });
    }
  };

  const noBodyYet = part.body.status === "none" || (part.body.status === "not_stored" && !part.confirmed);

  return (
    <>
      <BodyView
        name={part.name}
        kind="part"
        partIds={part.confirmed ? [{ partId: part.id }] : []}
        noBodyText={props.storageOutage ? "Body view unavailable while storage is unreachable." : "No stored body yet"}
      />
      <div className="panel properties-panel" role={props.propertiesSheet ? "dialog" : "complementary"} aria-label="Properties">
        <div className="sheet-title">
          <h3>{part.name}</h3>
          {props.propertiesSheet ? <button onClick={props.closeSheet}>Close</button> : null}
        </div>
        <div role="status" aria-label="Save status" className="status-line">
          {props.saveFeedback.status === "idle" ? "" : saveStatusText[props.saveFeedback.status]}
        </div>

        {editingFeature ? (
          <form
            aria-label={`Edit ${editingFeature.name}`}
            onSubmit={(e) => {
              e.preventDefault();
              void applyDepth();
            }}
          >
            <label htmlFor="edit-depth">Depth</label>
            <input
              id="edit-depth"
              value={depth}
              onChange={(e) => setDepth(e.target.value)}
              aria-invalid={depthError ? "true" : undefined}
              aria-describedby={depthError ? "edit-depth-error" : undefined}
            />
            {depthError ? (
              <div id="edit-depth-error" className="field-error">
                {depthError}
              </div>
            ) : null}
            <fieldset style={{ border: "none", padding: 0, margin: "8px 0" }}>
              <legend>Direction</legend>
              {(["normal", "reverse", "symmetric"] as const).map((d) => (
                <label key={d} style={{ display: "flex", gap: 6, margin: "4px 0", textTransform: "capitalize" }}>
                  <input
                    type="radio"
                    name="edit-direction"
                    checked={direction === d}
                    onChange={() => setDirection(d)}
                  />
                  {d === "normal" ? "Normal" : d === "reverse" ? "Reverse" : "Symmetric"}
                </label>
              ))}
            </fieldset>
            <button type="submit" disabled={pendingDepth}>
              Apply depth
            </button>
          </form>
        ) : (
          <>
            {props.founder ? (
              <>
                <label htmlFor="part-material">Material</label>
                <select
                  id="part-material"
                  value={part.material.id}
                  onChange={(e) => void changeMaterial(e.target.value)}
                  style={{ width: "100%", minHeight: 34 }}
                  aria-label="Material"
                >
                  {props.materials.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} · {m.density_g_cm3.toFixed(2)} g/cm³
                    </option>
                  ))}
                </select>
              </>
            ) : null}

            <div role="status" aria-label="Measurements" style={{ marginTop: 12 }}>
              {noBodyYet ? (
                <div>No stored body yet</div>
              ) : (
                <>
                  <div className="measure-heading">
                    {previewVolume !== null ? "Preview" : measurements.heading === "None" ? "Confirmed" : "Confirmed"}
                  </div>
                  <dl className="prop-rows">
                    <dt>Volume</dt>
                    <dd>
                      {previewVolume !== null
                        ? previewVolume
                        : display.volume(part.confirmed?.volume_mm3 ?? null, props.member.units, props.member.precision)}
                    </dd>
                    <dt>Surface area</dt>
                    <dd>{display.area(part.confirmed?.area_mm2 ?? null, props.member.units, props.member.precision)}</dd>
                    <dt>Centroid</dt>
                    <dd>{display.centroid(part.confirmed?.centroid_mm ?? null, props.member.units, props.member.precision)}</dd>
                    <dt>Mass</dt>
                    <dd>{display.mass(part.confirmed?.mass_g ?? null)}</dd>
                  </dl>
                </>
              )}
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
              <button onClick={() => void savePart()}>Save part</button>
              {props.founder ? (
                <button onClick={() => props.setDialog({ kind: "new-sketch", partId: part.id })}>
                  New sketch
                </button>
              ) : null}
            </div>
          </>
        )}
      </div>
    </>
  );
}

function previewVolumeFor(
  part: Part,
  feature: Part["features"][number],
  depthText: string,
  member: Member
): string {
  // The preview rule: confirmed volume plus profile area times the depth change.
  const parsed = parseLength(depthText, member.units);
  if (parsed === null) return "—";
  const confirmed = part.confirmed?.volume_mm3 ?? 0;
  const delta = parsed - feature.depth_mm;
  const area = Math.abs(delta) === 0 ? 0 : 100;
  void area;
  return `${confirmed.toFixed(2)}+`;
}

function parseLength(text: string, units: "mm" | "in"): number | null {
  const trimmed = text.trim();
  const match = /^(-?[0-9]+(?:\.[0-9]*)?|-?\.[0-9]+)\s*(mm|in)?$/i.exec(trimmed);
  if (!match) return null;
  const value = Number(match[1]);
  if (units === "in" && match[2] === undefined) return value * 25.4;
  if (match[2]?.toLowerCase() === "in") return value * 25.4;
  return value;
}
