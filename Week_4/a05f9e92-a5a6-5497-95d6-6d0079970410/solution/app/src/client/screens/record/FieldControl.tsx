import type { Value } from "../../../shared/expression.js";
import { SCALE_LABELS, type FieldSpec } from "../../../shared/fields.js";
import { Combobox, type Choice } from "./Combobox.js";
import { sentence } from "./model.js";

interface Props {
  spec: FieldSpec;
  id: string;
  label: string;
  mandatory: boolean;
  /** The value in the form now (instants: the text as typed or as displayed). */
  value: Value;
  /** The stored value's readable text, used while a reference is not among the choices. */
  display: string;
  /** Choices for a reference field the role may read; absent means a plain text input. */
  choices: Choice[] | undefined;
  error: string | undefined;
  /** The field was refused without a message of its own: its message is shown elsewhere. */
  flagged: boolean;
  onChange(value: Value): void;
}

function control(props: Props, describedBy: string | undefined): JSX.Element {
  const { spec, id, mandatory, value, display, choices, error, flagged, onChange } = props;
  const invalid = error !== undefined || flagged;
  const common = { id, "aria-required": mandatory || undefined, "aria-invalid": invalid || undefined, "aria-describedby": describedBy };
  const text = value === null ? "" : String(value);
  switch (spec.kind) {
    case "long":
      return <textarea {...common} rows={3} value={text} onChange={(event) => onChange(event.target.value)} />;
    case "boolean":
      return <input {...common} type="checkbox" checked={value === true} onChange={(event) => onChange(event.target.checked)} />;
    case "enum":
      return (
        <select {...common} value={text} onChange={(event) => onChange(event.target.value === "" ? null : event.target.value)}>
          <option value="" />
          {(spec.values ?? []).map((choice) => (
            <option key={choice} value={choice}>
              {sentence(choice)}
            </option>
          ))}
        </select>
      );
    case "integer":
      if (spec.values)
        return (
          <select {...common} value={text} onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))}>
            {value === null ? <option value="" /> : null}
            {spec.values.map((choice) => (
              <option key={choice} value={choice}>
                {SCALE_LABELS[Number(choice)] ? `${choice} ${SCALE_LABELS[Number(choice)]}` : choice}
              </option>
            ))}
          </select>
        );
      return <input {...common} type="number" min={0} value={text} onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))} />;
    case "reference":
      if (choices)
        return <Combobox id={id} choices={choices} value={value === null ? null : String(value)} shown={display} required={mandatory} invalid={invalid} describedBy={describedBy} onPick={onChange} />;
      return <input {...common} type="text" value={text} onChange={(event) => onChange(event.target.value === "" ? null : event.target.value)} />;
    case "instant":
      return <input {...common} type="text" placeholder="YYYY-MM-DD HH:mm" inputMode="numeric" value={text} onChange={(event) => onChange(event.target.value)} />;
    default:
      return <input {...common} type="text" value={text} onChange={(event) => onChange(event.target.value)} />;
  }
}

/** One editable field: a label tied to its control, a Required word when a policy makes it mandatory, and its error. */
export function FieldControl(props: Props): JSX.Element {
  const { spec, id, label, mandatory, error } = props;
  const errorId = `${id}-error`;
  const describedBy = error ? errorId : undefined;
  const wide = spec.kind === "long" || spec.name === "short_description" || spec.name === "title";
  return (
    <div className={`rf-field ${wide ? "rf-wide" : ""}`} data-field={spec.name}>
      {spec.kind === "boolean" ? (
        <label className="rf-check" id={`${id}-label`}>
          {control(props, describedBy)}
          <span>{label}</span>
        </label>
      ) : (
        <div className="rf-field-head">
          <label id={`${id}-label`} htmlFor={id}>
            {label}
          </label>
          {mandatory ? <span className="rf-required">Required</span> : null}
        </div>
      )}
      {spec.kind === "boolean" ? null : control(props, describedBy)}
      {error ? (
        <p id={errorId} className="field-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
