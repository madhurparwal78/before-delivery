import { useRef, useState } from "react";
import { lengthNumber, toMillimetres, type Unit } from "../../shared/units";
import { FIELD_MESSAGES } from "../copy";
import { luxHours, luxText } from "../format";
import { Button } from "../ui/Button";
import { ErrorSummary, FieldMessage, type FieldError } from "../ui/ErrorSummary";
import { Modal } from "../ui/Modal";
import { focusWhenReady } from "../ui/focus";
import type { Placement, Wall } from "../types";

export interface PositionDraft {
  wallId: string;
  offsetMm: number;
  centreHeightMm: number;
  heightOverride: boolean;
}

/** Which field a rejection or validation message belongs to (brief: Interactions, Placing). */
export function fieldFor(reasonOrField: string): "wall" | "offset" | "centre" | null {
  switch (reasonOrField) {
    case "too_bright":
    case "wallId":
      return "wall";
    case "off_wall":
    case "too_close":
    case "offsetMm":
      return "offset";
    case "off_centre_line":
    case "centreHeightMm":
    case "heightOverride":
      return "centre";
    default:
      return null;
  }
}

export type PositionErrors = Partial<Record<"wall" | "offset" | "centre", string>>;

interface PositionFormProps {
  idPrefix: string;
  label: string;
  submitLabel: string;
  closeLabel: string;
  walls: Wall[];
  showWall: boolean;
  unit: Unit;
  initial: PositionDraft | null;
  opener: HTMLElement | null;
  onClose: () => void;
  /** Resolves to field errors to show, or null when saved (the caller closes the dialog). */
  onSubmit: (draft: PositionDraft) => Promise<PositionErrors | null>;
}

const ORDER = ["wall", "offset", "centre"] as const;

/** The Place work and Placement details dialogs share this form. */
export function PositionDialog({ idPrefix, label, submitLabel, closeLabel, walls, showWall, unit, initial, opener, onClose, onSubmit }: PositionFormProps) {
  const [wallId, setWallId] = useState(initial?.wallId ?? walls[0]?.id ?? "");
  const [offset, setOffset] = useState(initial ? lengthNumber(initial.offsetMm, unit) : "");
  const [centre, setCentre] = useState(lengthNumber(initial?.centreHeightMm ?? 1450, unit));
  const [exception, setException] = useState(initial?.heightOverride ?? false);
  const [errors, setErrors] = useState<PositionErrors>({});
  const [busy, setBusy] = useState(false);
  const summary = useRef<HTMLDivElement>(null);
  const ids = { wall: `${idPrefix}-wall`, offset: `${idPrefix}-offset`, centre: `${idPrefix}-centre` };

  const submit = async () => {
    if (busy) return;
    const offsetMm = toMillimetres(offset, unit);
    const centreMm = toMillimetres(centre, unit);
    const local: PositionErrors = {};
    if (offsetMm === null || offset.trim() === "") local.offset = FIELD_MESSAGES.wholeMm;
    if (centreMm === null || centre.trim() === "") local.centre = FIELD_MESSAGES.wholeMm;
    let found: PositionErrors | null = local;
    if (offsetMm !== null && centreMm !== null && !Object.keys(local).length) {
      setBusy(true);
      try {
        found = await onSubmit({ wallId, offsetMm, centreHeightMm: centreMm, heightOverride: exception });
      } finally {
        setBusy(false);
      }
    }
    if (found) {
      setErrors(found);
      focusWhenReady(() => summary.current);
    }
  };

  const summaryErrors: FieldError[] = ORDER.filter((k) => errors[k]).map((k) => ({ fieldId: ids[k], message: errors[k]! }));
  const describe = (k: keyof typeof ids) => (errors[k] ? `${ids[k]}-error` : undefined);

  return (
    <Modal label={label} onClose={onClose} opener={opener}>
      <form
        className="form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <ErrorSummary ref={summary} errors={summaryErrors} />
        {showWall && (
          <div className="field">
            <label htmlFor={ids.wall}>Wall</label>
            <select
              id={ids.wall}
              value={wallId}
              aria-invalid={errors.wall ? true : undefined}
              aria-describedby={describe("wall")}
              onChange={(e) => setWallId(e.target.value)}
            >
              {walls.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
            <FieldMessage id={ids.wall} message={errors.wall} />
          </div>
        )}
        <div className="field">
          <label htmlFor={ids.offset}>Offset from left end</label>
          <div className="with-unit">
            <input
              id={ids.offset}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={offset}
              aria-invalid={errors.offset ? true : undefined}
              aria-describedby={describe("offset")}
              onChange={(e) => setOffset(e.target.value)}
            />
            <span className="unit-label" aria-hidden="true">
              {unit}
            </span>
          </div>
          <FieldMessage id={ids.offset} message={errors.offset} />
        </div>
        <div className="field">
          <label htmlFor={ids.centre}>Centre height</label>
          <div className="with-unit">
            <input
              id={ids.centre}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={centre}
              aria-invalid={errors.centre ? true : undefined}
              aria-describedby={describe("centre")}
              onChange={(e) => setCentre(e.target.value)}
            />
            <span className="unit-label" aria-hidden="true">
              {unit}
            </span>
          </div>
          <FieldMessage id={ids.centre} message={errors.centre} />
        </div>
        <div className="field field-check">
          <input id={`${idPrefix}-exception`} type="checkbox" checked={exception} onChange={(e) => setException(e.target.checked)} />
          <label htmlFor={`${idPrefix}-exception`}>Off the centre line (exception)</label>
        </div>
        <div className="form-actions">
          <Button tone="primary" type="submit" busy={busy}>
            {submitLabel}
          </Button>
          <Button onClick={onClose}>{closeLabel}</Button>
        </div>
      </form>
    </Modal>
  );
}

export function LuxDialog({ placement, opener, onClose }: { placement: Placement; opener: HTMLElement | null; onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  return (
    <Modal label="Lux details" onClose={onClose} opener={opener} initialFocus={() => close.current}>
      <p className="lux-work">{placement.objectTitle}</p>
      <ul className="lux-lines">
        <li>{`Planned lux ${luxText(placement.plannedLux)}`}</li>
        <li>{`Lux limit ${luxText(placement.luxLimit)}`}</li>
        <li>{`Planned lux-hours ${luxHours(placement.plannedLuxHours)} lux-hours`}</li>
        <li>{`Lux-hour budget ${luxHours(placement.luxHourBudget)} lux-hours`}</li>
        <li className={placement.luxStatus === "over" ? "lux-over" : undefined}>
          {`Status ${placement.luxStatus === "over" ? "Over budget" : "Within limit"}`}
        </li>
      </ul>
      <div className="form-actions">
        <Button ref={close} onClick={onClose}>
          Close
        </Button>
      </div>
    </Modal>
  );
}
