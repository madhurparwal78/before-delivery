import { useRef, useState, type ReactNode } from "react";
import { Dialog } from "./Dialog.jsx";
import { chainage, measure } from "../../shared/format.js";
import type { Finding } from "../lib/types.js";

export interface EditorDraft {
  groundHeight: string;
  offset: string;
  canopyHeight: string;
  canopyRadius: string;
  comment: string;
  terrainLevel: number | null;
}

export interface EditorProps {
  finding: Finding | null;
  chainageM: number;
  spanLabel: string;
  prefill: { groundHeight: string; terrainLevel: number | null };
  fieldErrors: Record<string, string>;
  pending: boolean;
  onSave: (draft: EditorDraft) => void;
  onDelete: () => void;
  onClose: () => void;
}

const FIELD_IDS = {
  ground_height_m: "field-ground-height",
  offset_m: "field-offset",
  canopy_height_m: "field-canopy-height",
  canopy_radius_m: "field-canopy-radius",
  comment: "field-comment",
  position: "field-offset",
  chainage_m: "field-offset",
  terrain_level: "field-ground-height",
} as const;

export function FindingEditor(props: EditorProps): ReactNode {
  const editing = props.finding;
  const [draft, setDraft] = useState<EditorDraft>(() => ({
    groundHeight: editing ? measure(editing.ground_height_m) : props.prefill.groundHeight,
    offset: editing ? measure(editing.offset_m) : "0",
    canopyHeight: editing ? measure(editing.canopy_height_m) : "",
    canopyRadius: editing ? measure(editing.canopy_radius_m) : "3.00",
    comment: editing ? editing.comment : "",
    terrainLevel: editing ? editing.terrain_level : props.prefill.terrainLevel,
  }));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const panel = useRef<HTMLDivElement | null>(null);

  const update = (patch: Partial<EditorDraft>): void => setDraft((current) => ({ ...current, ...patch }));

  const errorEntries = Object.entries(props.fieldErrors);
  const title = editing ? `Edit finding ${editing.label}` : "New finding";

  const focusField = (field: string): void => {
    const id = FIELD_IDS[field as keyof typeof FIELD_IDS];
    if (!id) return;
    panel.current?.ownerDocument.getElementById(id)?.focus();
  };

  return (
    <Dialog
      title={title}
      onClose={props.onClose}
      onSubmit={() => props.onSave(draft)}
      footer={
        <>
          <button
            type="button"
            className="button button--primary"
            aria-disabled={props.pending}
            onClick={() => props.onSave(draft)}
          >
            Save finding
          </button>
          <button type="button" className="button" onClick={props.onClose}>
            Cancel
          </button>
          {editing ? (
            <button
              type="button"
              className="button button--danger"
              onClick={() => {
                if (confirmDelete) {
                  props.onDelete();
                } else {
                  setConfirmDelete(true);
                }
              }}
            >
              {confirmDelete ? "Confirm delete" : "Delete finding"}
            </button>
          ) : null}
        </>
      }
    >
      <div ref={panel}>
        {errorEntries.length > 0 ? (
          <div className="error-summary">
            <h3>Fix these fields</h3>
            <ul>
              {errorEntries.map(([field, message]) => (
                <li key={field}>
                  <a
                    href={`#${FIELD_IDS[field as keyof typeof FIELD_IDS] ?? ""}`}
                    onClick={(event) => {
                      event.preventDefault();
                      focusField(field);
                    }}
                  >
                    {message}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <p className="mono editor__fixed">Chainage {chainage(props.chainageM)} m</p>
        <p className="mono editor__fixed">{props.spanLabel}</p>
        <p className="mono editor__fixed">
          Terrain level {draft.terrainLevel === null ? "hand-entered" : String(draft.terrainLevel)}
        </p>

        <label className="field">
          <span className="field__label">Ground height (m)</span>
          <input
            id={FIELD_IDS.ground_height_m}
            className="field__input mono"
            type="text"
            inputMode="decimal"
            value={draft.groundHeight}
            aria-invalid={Boolean(props.fieldErrors.ground_height_m)}
            onChange={(event) =>
              update({ groundHeight: event.target.value, terrainLevel: null })
            }
          />
          {props.fieldErrors.ground_height_m ? (
            <span className="field__error">{props.fieldErrors.ground_height_m}</span>
          ) : null}
        </label>

        <label className="field">
          <span className="field__label">Offset from centreline (m)</span>
          <input
            id={FIELD_IDS.offset_m}
            className="field__input mono"
            type="text"
            inputMode="decimal"
            value={draft.offset}
            aria-invalid={Boolean(props.fieldErrors.offset_m)}
            onChange={(event) => update({ offset: event.target.value })}
          />
          {props.fieldErrors.offset_m ? (
            <span className="field__error">{props.fieldErrors.offset_m}</span>
          ) : null}
        </label>

        <label className="field">
          <span className="field__label">Canopy height above ground (m)</span>
          <input
            id={FIELD_IDS.canopy_height_m}
            className="field__input mono"
            type="text"
            inputMode="decimal"
            value={draft.canopyHeight}
            aria-invalid={Boolean(props.fieldErrors.canopy_height_m)}
            onChange={(event) => update({ canopyHeight: event.target.value })}
          />
          {props.fieldErrors.canopy_height_m ? (
            <span className="field__error">{props.fieldErrors.canopy_height_m}</span>
          ) : null}
        </label>

        <label className="field">
          <span className="field__label">Canopy radius (m)</span>
          <input
            id={FIELD_IDS.canopy_radius_m}
            className="field__input mono"
            type="text"
            inputMode="decimal"
            value={draft.canopyRadius}
            aria-invalid={Boolean(props.fieldErrors.canopy_radius_m)}
            onChange={(event) => update({ canopyRadius: event.target.value })}
          />
          {props.fieldErrors.canopy_radius_m ? (
            <span className="field__error">{props.fieldErrors.canopy_radius_m}</span>
          ) : null}
        </label>

        <label className="field">
          <span className="field__label">Comment</span>
          <textarea
            id={FIELD_IDS.comment}
            className="field__input"
            rows={3}
            value={draft.comment}
            aria-invalid={Boolean(props.fieldErrors.comment)}
            onChange={(event) => update({ comment: event.target.value })}
          />
          {props.fieldErrors.comment ? (
            <span className="field__error">{props.fieldErrors.comment}</span>
          ) : null}
        </label>
      </div>
    </Dialog>
  );
}
