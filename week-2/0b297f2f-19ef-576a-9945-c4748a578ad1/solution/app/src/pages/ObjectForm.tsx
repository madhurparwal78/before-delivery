import { useRef, useState } from "react";
import { lengthNumber, type Unit } from "../../shared/units";
import { request } from "../api";
import { say } from "../copy";
import { useStore, isFailure } from "../store";
import { Button } from "../ui/Button";
import { ErrorSummary, FieldMessage } from "../ui/ErrorSummary";
import { Modal } from "../ui/Modal";
import { focusWhenReady } from "../ui/focus";
import type { ObjectRecord } from "../types";

const FIELDS = [
  ["title", "Title"],
  ["objectNumber", "Object number"],
  ["lenderId", "Lender"],
  ["medium", "Medium"],
  ["width", "Width"],
  ["height", "Height"],
  ["luxLimit", "Lux limit"],
  ["luxHourBudget", "Lux-hour budget"],
  ["insuranceValueGbp", "Insurance value"],
  ["registrarNote", "Registrar note"],
] as const;
type Field = (typeof FIELDS)[number][0];

function numberOrText(text: string): number | string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  return /^-?\d+(\.\d+)?$/.test(trimmed) ? Number(trimmed) : trimmed;
}

interface Props {
  /** The record being edited; without one the form adds an object. */
  object?: ObjectRecord;
  opener: HTMLElement | null;
  unit: Unit;
  onClose: () => void;
  onSaved: (object: ObjectRecord) => void;
}

/** Add object and Edit object: the same fields, errors beside each field and in the summary. */
export function ObjectForm({ object, opener, unit, onClose, onSaved }: Props) {
  const store = useStore();
  const lenders = store.exhibition?.lenders ?? [];
  const start: Record<Field, string> = {
    title: object?.title ?? "",
    objectNumber: object?.objectNumber ?? "",
    lenderId: object ? (object.lenderId ?? "collection") : "",
    medium: object?.medium ?? "",
    width: object ? lengthNumber(object.widthMm, unit) : "",
    height: object ? lengthNumber(object.heightMm, unit) : "",
    luxLimit: object ? String(object.luxLimit) : "",
    luxHourBudget: object ? String(object.luxHourBudget) : "",
    insuranceValueGbp: object ? String(object.insuranceValueGbp) : "",
    registrarNote: object?.registrarNote ?? "",
  };
  const [values, setValues] = useState(start);
  const [errors, setErrors] = useState<Partial<Record<Field | "unit", string>>>({});
  const [busy, setBusy] = useState(false);
  const summary = useRef<HTMLDivElement>(null);

  const submit = async () => {
    if (busy) return;
    const body: Record<string, unknown> = {
      title: values.title,
      objectNumber: values.objectNumber,
      medium: values.medium,
      luxLimit: numberOrText(values.luxLimit),
      luxHourBudget: numberOrText(values.luxHourBudget),
      insuranceValueGbp: numberOrText(values.insuranceValueGbp),
      registrarNote: values.registrarNote,
    };
    if (values.lenderId) body.lenderId = values.lenderId === "collection" ? null : values.lenderId;
    const sizeChanged = !object || values.width !== start.width || values.height !== start.height;
    if (sizeChanged) Object.assign(body, { width: numberOrText(values.width), height: numberOrText(values.height), unit });
    setBusy(true);
    try {
      const data =
        object
          ? await request<{ object: ObjectRecord }>("PATCH", `/api/objects/${object.id}`, body)
          : await request<{ object: ObjectRecord }>("POST", "/api/objects", body);
      store.putObject(data.object);
      store.announce(say.objectSaved(data.object.title));
      onSaved(data.object);
    } catch (failure) {
      if (!isFailure(failure)) throw failure;
      const found = { ...failure.fields } as Partial<Record<Field | "unit", string>>;
      if (!Object.keys(found).length) found.title = failure.message;
      setErrors(found);
      store.announce(Object.values(found).join(" "));
      focusWhenReady(() => summary.current);
    } finally {
      setBusy(false);
    }
  };

  const id = (f: Field) => `object-${f}`;
  const summaryErrors = [
    ...FIELDS.filter(([f]) => errors[f]).map(([f]) => ({ fieldId: id(f), message: errors[f]! })),
    ...(errors.unit ? [{ fieldId: id("width"), message: errors.unit }] : []),
  ];
  const input = (f: Field, label: string, extra?: { unitLabel?: string; numeric?: boolean }) => (
    <div className="field" key={f}>
      <label htmlFor={id(f)}>{label}</label>
      <div className={extra?.unitLabel ? "with-unit" : undefined}>
        {f === "registrarNote" ? (
          <textarea
            id={id(f)}
            rows={3}
            value={values[f]}
            aria-invalid={errors[f] ? true : undefined}
            aria-describedby={errors[f] ? `${id(f)}-error` : undefined}
            onChange={(e) => setValues((v) => ({ ...v, [f]: e.target.value }))}
          />
        ) : (
          <input
            id={id(f)}
            type="text"
            inputMode={extra?.numeric ? "decimal" : undefined}
            autoComplete="off"
            value={values[f]}
            aria-invalid={errors[f] ? true : undefined}
            aria-describedby={errors[f] ? `${id(f)}-error` : undefined}
            onChange={(e) => setValues((v) => ({ ...v, [f]: e.target.value }))}
          />
        )}
        {extra?.unitLabel && (
          <span className="unit-label" aria-hidden="true">
            {extra.unitLabel}
          </span>
        )}
      </div>
      <FieldMessage id={id(f)} message={errors[f]} />
    </div>
  );

  return (
    <Modal label={object ? "Edit object" : "Add object"} onClose={onClose} opener={opener} wide>
      <form
        className="form form-grid"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <ErrorSummary ref={summary} errors={summaryErrors} />
        {input("title", "Title")}
        {input("objectNumber", "Object number")}
        <div className="field">
          <label htmlFor={id("lenderId")}>Lender</label>
          <select
            id={id("lenderId")}
            value={values.lenderId}
            aria-invalid={errors.lenderId ? true : undefined}
            aria-describedby={errors.lenderId ? `${id("lenderId")}-error` : undefined}
            onChange={(e) => setValues((v) => ({ ...v, lenderId: e.target.value }))}
          >
            <option value="">Choose a lender</option>
            <option value="collection">Ashgrove collection</option>
            {lenders.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <FieldMessage id={id("lenderId")} message={errors.lenderId} />
        </div>
        {input("medium", "Medium")}
        {input("width", "Width", { unitLabel: unit, numeric: true })}
        {input("height", "Height", { unitLabel: unit, numeric: true })}
        {errors.unit && <p className="field-error">{errors.unit}</p>}
        {input("luxLimit", "Lux limit", { unitLabel: "lux", numeric: true })}
        {input("luxHourBudget", "Lux-hour budget", { unitLabel: "lux-hours", numeric: true })}
        {input("insuranceValueGbp", "Insurance value", { unitLabel: "£", numeric: true })}
        {input("registrarNote", "Registrar note")}
        <div className="form-actions">
          <Button tone="primary" type="submit" busy={busy}>
            Save object
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Modal>
  );
}
