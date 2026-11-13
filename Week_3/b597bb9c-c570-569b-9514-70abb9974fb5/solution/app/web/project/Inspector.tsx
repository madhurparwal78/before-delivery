import { useState, type ReactNode } from "react";
import { frameSize, shownValue } from "../../shared/layers";
import { PROPERTIES, type Curve, type Property } from "../../shared/keyframes";
import { notify } from "../lib/notices";
import { removeKeyframe, setKeyframe } from "./actions";
import { useProject } from "./context";
import { canEdit } from "./state";

const LABELS: Record<Property, string> = { x: "X", y: "Y", scale: "Scale", rotation: "Rotation", opacity: "Opacity" };

export function Inspector(): ReactNode {
  const { store, state } = useProject();
  const [curve, setCurve] = useState<Curve>("linear");
  const [kitId, setKitId] = useState("");
  const [typed, setTyped] = useState<Partial<Record<Property, string>>>({});
  const editor = canEdit(state.role);
  const clip = state.clips.find((candidate) => candidate.id === state.current);
  const frame = state.skim ? state.skim.frame : state.playhead;
  const size = frameSize(state.project.aspect_ratio);

  return (
    <section role="region" aria-label="Inspector" className="inspector">
      <p className="muted">{clip ? clip.name : "No clip selected."}</p>
      {clip
        ? PROPERTIES.map((property) => {
            const value = shownValue(clip, property, frame, size);
            return (
              <div key={property} data-prop={property} className="prop">
                <span className="muted">{LABELS[property]}</span> <span className="tnum">{value.toFixed(2)}</span>
                {editor ? (
                  <span className="prop-edit">
                    <input
                      aria-label={`${LABELS[property]} at the playhead`}
                      inputMode="decimal"
                      value={typed[property] ?? ""}
                      onChange={(event) => setTyped({ ...typed, [property]: event.target.value })}
                    />
                    <button
                      type="button"
                      aria-label={`Set ${LABELS[property]} diamond`}
                      onClick={() => {
                        const number = Number(typed[property] ?? value);
                        if (Number.isFinite(number)) void setKeyframe(store, clip.id, property, number, curve);
                        setTyped({ ...typed, [property]: "" });
                      }}
                    >
                      Set
                    </button>
                    <button type="button" aria-label={`Remove ${LABELS[property]} diamond`} onClick={() => void removeKeyframe(store, clip.id, property)}>
                      Clear
                    </button>
                  </span>
                ) : null}
              </div>
            );
          })
        : null}
      {editor ? (
        <div className="inspector-tools">
          <label>
            <span className="muted">Curve</span>
            <select value={curve} onChange={(event) => setCurve(event.target.value as Curve)}>
              <option value="linear">Linear</option>
              <option value="eased">Eased</option>
            </select>
          </label>
          <label>
            <span className="muted">Brand kit</span>
            <select value={kitId} onChange={(event) => setKitId(event.target.value)}>
              <option value="">Choose a kit</option>
              {state.kits.map((kit) => (
                <option key={kit.id} value={kit.id}>
                  {kit.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => {
              if (!kitId) {
                notify("Choose a brand kit first.");
                return;
              }
              void store.submit(() => ({ type: "apply_kit", kit_id: kitId }));
            }}
          >
            Apply kit
          </button>
        </div>
      ) : null}
    </section>
  );
}
