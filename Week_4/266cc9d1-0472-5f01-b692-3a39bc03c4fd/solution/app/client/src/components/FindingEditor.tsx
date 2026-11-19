// The finding editor: New finding (at the playhead or a picked point) and Edit finding <label>.
// Field messages come from the API and show under each field and in the error summary.
import { OctagonAlert } from "lucide-react";
import { useId, useRef, useState, type FormEvent } from "react";
import { api, ApiFailure, type Finding } from "../api";
import { chainageText, metres2 } from "../format";
import { Dialog } from "./Dialog";

export interface EditorTarget {
  mode: "new" | "edit";
  finding: Finding | null;
  chainageM: number;
  offsetM: number;
  spanLabel: string;
  ground: { heightM: number; level: number } | null;
  pick: { lonDeg: number; latDeg: number } | null;
  opener: HTMLElement | null;
}

interface EditorProps {
  target: EditorTarget;
  setId: string;
  onSaving: (label: string) => void;
  onSaved: (finding: Finding) => void;
  onInvalid: (label: string) => void;
  onDeleted: (finding: Finding) => void;
  onClosed: () => void;
}

type FieldName = "ground_height_m" | "offset_m" | "canopy_height_m" | "canopy_radius_m" | "comment";

const FIELDS: Array<{ name: FieldName; label: string; numeric: boolean }> = [
  { name: "ground_height_m", label: "Ground height (m)", numeric: true },
  { name: "offset_m", label: "Offset from centreline (m)", numeric: true },
  { name: "canopy_height_m", label: "Canopy height above ground (m)", numeric: true },
  { name: "canopy_radius_m", label: "Canopy radius (m)", numeric: true },
  { name: "comment", label: "Comment", numeric: false },
];

function numberOrNull(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

export function FindingEditor({ target, setId, onSaving, onSaved, onInvalid, onDeleted, onClosed }: EditorProps) {
  const ids = useId();
  const existing = target.finding;
  const [values, setValues] = useState<Record<FieldName, string>>(() =>
    existing !== null
      ? {
          ground_height_m: existing.ground_height_m.toFixed(2),
          offset_m: existing.offset_m.toFixed(2),
          canopy_height_m: existing.canopy_height_m.toFixed(2),
          canopy_radius_m: existing.canopy_radius_m.toFixed(2),
          comment: existing.comment,
        }
      : {
          ground_height_m: target.ground === null ? "" : target.ground.heightM.toFixed(2),
          offset_m: target.offsetM.toFixed(2),
          canopy_height_m: "",
          canopy_radius_m: "3.00",
          comment: "",
        },
  );
  const [level, setLevel] = useState<number | null>(existing !== null ? existing.terrain_level : (target.ground?.level ?? null));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const initial = useRef(values);
  const label = existing?.label ?? "new finding";
  const title = existing === null ? "New finding" : `Edit finding ${existing.label}`;
  const fieldId = (name: string) => `${ids}-${name}`;

  const body = (): Record<string, unknown> => {
    const ground = numberOrNull(values.ground_height_m);
    const offset = numberOrNull(values.offset_m);
    const common = {
      canopy_height_m: numberOrNull(values.canopy_height_m),
      canopy_radius_m: numberOrNull(values.canopy_radius_m),
      comment: values.comment,
    };
    if (existing === null) {
      const position = target.pick !== null && offset === target.offsetM
        ? { lon_deg: target.pick.lonDeg, lat_deg: target.pick.latDeg }
        : { chainage_m: target.chainageM, offset_m: offset };
      return { ...position, ground_height_m: ground, terrain_level: level, ...common };
    }
    const moved = values.ground_height_m !== initial.current.ground_height_m || values.offset_m !== initial.current.offset_m;
    const location = moved ? { chainage_m: existing.chainage_m, offset_m: offset, ground_height_m: ground, terrain_level: level } : {};
    return { ...location, ...common };
  };

  const save = async (event: FormEvent, close: () => void) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    onSaving(label);
    try {
      const path = existing === null ? `/api/findings-sets/${setId}/findings` : `/api/findings/${existing.id}`;
      const result = await api<{ finding: Finding }>(existing === null ? "POST" : "PATCH", path, { body: body() });
      setErrors({});
      onSaved(result.finding);
      close();
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 422) {
        setErrors(error.fields);
        onInvalid(label);
      } else if (error instanceof ApiFailure) {
        setErrors({ form: error.message });
        onInvalid(label);
      }
    } finally {
      setPending(false);
    }
  };

  const remove = async (close: () => void) => {
    if (existing === null) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setPending(true);
    try {
      await api("DELETE", `/api/findings/${existing.id}`);
      onDeleted(existing);
      close();
    } catch (error) {
      if (error instanceof ApiFailure) setErrors({ form: error.message });
    } finally {
      setPending(false);
    }
  };

  const fieldFor = (key: string): FieldName | null => {
    if (key === "chainage_m" || key === "position") return "offset_m";
    if (key === "terrain_level") return "ground_height_m";
    return FIELDS.find((f) => f.name === key)?.name ?? null;
  };
  const listed = Object.entries(errors);

  return (
    <Dialog title={title} opener={target.opener} onClosed={onClosed}>
      {(close) => (
        <form noValidate onSubmit={(event) => void save(event, close)} className="editor">
          <dl className="facts">
            <dt>Chainage</dt>
            <dd>{chainageText(existing?.chainage_m ?? target.chainageM)}</dd>
            <dt>Span</dt>
            <dd>{existing?.span.label ?? target.spanLabel}</dd>
            <dt>Terrain level</dt>
            <dd>{level === null ? "hand-entered" : String(level)}</dd>
            {existing !== null && (
              <>
                <dt>Clearance</dt>
                <dd>{metres2(existing.clearance_m)}</dd>
              </>
            )}
          </dl>
          {listed.length > 0 && (
            <div className="error-summary" role="group" aria-labelledby={`${ids}-summary`}>
              <h2 id={`${ids}-summary`}>Fix these fields</h2>
              <ul>
                {listed.map(([key, message]) => {
                  const field = fieldFor(key);
                  return (
                    <li key={key}>
                      <a
                        href={field === null ? "#" : `#${fieldId(field)}`}
                        onClick={(event) => {
                          event.preventDefault();
                          if (field !== null) document.getElementById(fieldId(field))?.focus();
                        }}
                      >
                        {message}
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          <div className="grid-2">
            {FIELDS.filter((f) => f.numeric).map((f) => {
              const message = Object.entries(errors).find(([key]) => fieldFor(key) === f.name)?.[1];
              return (
                <div className="field" key={f.name} data-invalid={message !== undefined}>
                  <label htmlFor={fieldId(f.name)}>{f.label}</label>
                  <input
                    id={fieldId(f.name)}
                    className="figure"
                    inputMode="decimal"
                    autoComplete="off"
                    value={values[f.name]}
                    aria-invalid={message !== undefined}
                    aria-describedby={message !== undefined ? `${fieldId(f.name)}-error` : undefined}
                    onChange={(event) => {
                      const next = event.target.value;
                      setValues((v) => ({ ...v, [f.name]: next }));
                      if (f.name === "ground_height_m") setLevel(null);
                    }}
                  />
                  {message !== undefined && (
                    <p className="field-error" id={`${fieldId(f.name)}-error`}>
                      <OctagonAlert size={14} aria-hidden="true" />
                      {message}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
          <div className="field" data-invalid={errors.comment !== undefined}>
            <label htmlFor={fieldId("comment")}>Comment</label>
            <textarea
              id={fieldId("comment")}
              value={values.comment}
              aria-invalid={errors.comment !== undefined}
              onChange={(event) => {
                const next = event.target.value;
                setValues((v) => ({ ...v, comment: next }));
              }}
            />
            {errors.comment !== undefined && (
              <p className="field-error">
                <OctagonAlert size={14} aria-hidden="true" />
                {errors.comment}
              </p>
            )}
          </div>
          {errors.form !== undefined && <p className="field-error">{errors.form}</p>}
          <div className="dialog-actions">
            {existing !== null && (
              <button type="button" className="button" aria-disabled={pending} onClick={() => void remove(close)}>
                {confirmDelete ? "Confirm delete" : "Delete finding"}
              </button>
            )}
            <span className="spacer" />
            <button type="button" className="button" onClick={close}>
              Cancel
            </button>
            <button type="submit" className="button primary" aria-disabled={pending}>
              Save finding
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
