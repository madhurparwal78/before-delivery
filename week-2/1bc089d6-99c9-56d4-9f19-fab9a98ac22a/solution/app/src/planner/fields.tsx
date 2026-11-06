import { forwardRef, useMemo, useState, type ReactNode } from "react";

import { HOUR_MINUTES, MAX_RITUAL_MINUTES, MIN_RITUAL_MINUTES, MINUTE_STEP, RITUALS, ritualById, type RitualId } from "../shared/rituals";
import {
  NOTE_MAX,
  copy,
  isBedtime,
  isNote,
  isRitualMinutes,
  isTimeZoneName,
  normaliseEmail,
  noteLength,
  parseRituals,
  startsAt,
  totalMinutes,
  type RitualChoice,
} from "../shared/hour";

export type HourField = "email" | "bedtime" | "time_zone" | "rituals" | "note";
export type FieldErrors = Partial<Record<HourField, string>>;

export interface HourValues {
  email: string;
  bedtime: string;
  time_zone: string;
  rituals: readonly RitualChoice[];
  note: string;
}

const FIELD_LABELS: Record<HourField, string> = {
  email: "Email",
  bedtime: "Bedtime",
  time_zone: "Time zone",
  rituals: "Rituals",
  note: "A note for tonight",
};

const FIELD_ORDER: HourField[] = ["bedtime", "time_zone", "rituals", "note", "email"];

/** The plan rules for the given fields, in the order the form shows them. */
export function checkHour(values: HourValues, fields: readonly HourField[]): FieldErrors {
  const problems: Record<HourField, () => string | null> = {
    email: () => (normaliseEmail(values.email) ? null : copy.email),
    bedtime: () => (isBedtime(values.bedtime) ? null : copy.bedtime),
    time_zone: () => (isTimeZoneName(values.time_zone) ? null : copy.timeZone),
    rituals: () => (parseRituals(values.rituals) ? null : copy.rituals),
    note: () => (isNote(values.note) ? null : copy.note),
  };
  const errors: FieldErrors = {};
  for (const field of FIELD_ORDER) {
    const problem = fields.includes(field) ? problems[field]() : null;
    if (problem) errors[field] = problem;
  }
  return errors;
}

/** Keeps only the server's messages for fields this form shows. */
export function hourErrors(fields: Record<string, string>): FieldErrors {
  return Object.fromEntries(FIELD_ORDER.filter((field) => fields[field]).map((field) => [field, fields[field]]));
}

const fieldId = (prefix: string, field: HourField) => `${prefix}-${field.replace("_", "-")}`;

/** Moves focus to a field; the rituals group focuses its first enabled control. */
function focusField(prefix: string, field: HourField) {
  const target = document.getElementById(fieldId(prefix, field));
  if (!target) return;
  const control = field === "rituals" ? target.querySelector<HTMLElement>("input:not(:disabled)") : target;
  control?.focus();
}

const BEDTIMES = Array.from({ length: (24 * 60) / MINUTE_STEP }, (_, step) => {
  const minutes = step * MINUTE_STEP;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
});

export function browserZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function FieldMessage({ id, message }: { id: string; message?: string }) {
  return message ? (
    <p className="sh-field__error" id={id}>
      {message}
    </p>
  ) : null;
}

const describedBy = (...ids: Array<string | false | undefined>) => ids.filter(Boolean).join(" ") || undefined;

interface SimpleFieldProps {
  prefix: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
}

export function EmailField({ prefix, value, error, onChange }: SimpleFieldProps) {
  const id = fieldId(prefix, "email");
  return (
    <div className="sh-field" data-invalid={error ? "true" : undefined}>
      <label className="sh-field__label" htmlFor={id}>
        {FIELD_LABELS.email}
      </label>
      <input
        className="sh-input"
        id={id}
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        spellCheck={false}
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(error && `${id}-error`)}
        onChange={(event) => onChange(event.target.value)}
      />
      <FieldMessage id={`${id}-error`} message={error} />
    </div>
  );
}

export function BedtimeField({ prefix, value, error, onChange }: SimpleFieldProps) {
  const id = fieldId(prefix, "bedtime");
  return (
    <div className="sh-field" data-invalid={error ? "true" : undefined}>
      <label className="sh-field__label" htmlFor={id}>
        {FIELD_LABELS.bedtime}
      </label>
      <select
        className="sh-input sh-input--select sh-input--numeral"
        id={id}
        name="bedtime"
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(error && `${id}-error`)}
        onChange={(event) => onChange(event.target.value)}
      >
        {BEDTIMES.map((time) => (
          <option key={time} value={time}>
            {time}
          </option>
        ))}
      </select>
      <FieldMessage id={`${id}-error`} message={error} />
    </div>
  );
}

export function TimeZoneField({ prefix, value, error, onChange }: SimpleFieldProps) {
  const id = fieldId(prefix, "time_zone");
  const zones = useMemo(() => {
    const known = Intl.supportedValuesOf("timeZone");
    return known.includes(value) ? known : [value, ...known];
  }, [value]);
  return (
    <div className="sh-field" data-invalid={error ? "true" : undefined}>
      <label className="sh-field__label" htmlFor={id}>
        {FIELD_LABELS.time_zone}
      </label>
      <select
        className="sh-input sh-input--select"
        id={id}
        name="time_zone"
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(error && `${id}-error`)}
        onChange={(event) => onChange(event.target.value)}
      >
        {zones.map((zone) => (
          <option key={zone} value={zone}>
            {zone}
          </option>
        ))}
      </select>
      <FieldMessage id={`${id}-error`} message={error} />
    </div>
  );
}

export function NoteField({ prefix, value, error, onChange }: SimpleFieldProps) {
  const id = fieldId(prefix, "note");
  return (
    <div className="sh-field" data-invalid={error ? "true" : undefined}>
      <label className="sh-field__label" htmlFor={id}>
        {FIELD_LABELS.note}
      </label>
      <textarea
        className="sh-input sh-input--note"
        id={id}
        name="note"
        rows={3}
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(error && `${id}-error`, `${id}-count`)}
        onChange={(event) => onChange(event.target.value)}
      />
      <p className="sh-field__hint" id={`${id}-count`}>
        {noteLength(value)} of {NOTE_MAX} characters
      </p>
      <FieldMessage id={`${id}-error`} message={error} />
    </div>
  );
}

interface RitualControls {
  chosen: readonly RitualChoice[];
  /** Each returns false when the change is refused (it would take the hour past 60 minutes). */
  add: (id: RitualId) => boolean;
  remove: (id: RitualId) => void;
  setMinutes: (id: RitualId, minutes: number) => boolean;
}

function MinutesInput({ title, minutes, enabled, onCommit }: { title: string; minutes: number; enabled: boolean; onCommit: (minutes: number) => boolean }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      className="sh-input sh-input--minutes"
      type="number"
      inputMode="numeric"
      min={MIN_RITUAL_MINUTES}
      max={MAX_RITUAL_MINUTES}
      step={MINUTE_STEP}
      aria-label={`${title} minutes`}
      disabled={!enabled}
      value={draft ?? String(minutes)}
      onChange={(event) => {
        const text = event.target.value;
        const value = Number(text);
        if (text !== "" && isRitualMinutes(value)) {
          onCommit(value);
          setDraft(null);
        } else {
          setDraft(text);
        }
      }}
      onBlur={() => setDraft(null)}
    />
  );
}

/** One checkbox and one minutes box per catalogue ritual; minutes are editable only while the ritual is chosen. */
export function RitualsField({ prefix, controls, error }: { prefix: string; controls: RitualControls; error?: string }) {
  const id = fieldId(prefix, "rituals");
  return (
    <fieldset
      className="sh-rituals"
      id={id}
      data-invalid={error ? "true" : undefined}
      aria-describedby={describedBy(error && `${id}-error`)}
    >
      <legend className="sh-field__label">{FIELD_LABELS.rituals}</legend>
      <ul className="sh-rituals__list" role="list">
        {RITUALS.map((ritual) => {
          const chosen = controls.chosen.find((entry) => entry.id === ritual.id);
          return (
            <li key={ritual.id} className="sh-rituals__item" data-chosen={chosen ? "true" : undefined}>
              <label className="sh-rituals__title">
                <input
                  className="sh-check"
                  type="checkbox"
                  checked={Boolean(chosen)}
                  aria-invalid={error ? true : undefined}
                  onChange={(event) => {
                    if (event.target.checked) controls.add(ritual.id);
                    else controls.remove(ritual.id);
                  }}
                />
                {ritual.title}
              </label>
              <span className="sh-rituals__minutes">
                <MinutesInput
                  title={ritual.title}
                  minutes={chosen?.minutes ?? ritual.minutes}
                  enabled={Boolean(chosen)}
                  onCommit={(minutes) => controls.setMinutes(ritual.id, minutes)}
                />
                <span aria-hidden="true">min</span>
              </span>
            </li>
          );
        })}
      </ul>
      <FieldMessage id={`${id}-error`} message={error} />
    </fieldset>
  );
}

/** The live summary of the hour: when it starts and ends, and how much of the sixty minutes is planned. */
export function HourSummary({ bedtime, zone, rituals, children }: { bedtime: string; zone: string; rituals: readonly RitualChoice[]; children?: ReactNode }) {
  const total = totalMinutes(rituals);
  return (
    <div className="sh-summary">
      <p className="sh-summary__when">
        Your hour starts at {startsAt(bedtime)} and ends at {bedtime}, {zone} time.
      </p>
      <p className="sh-summary__total">
        {total} of {HOUR_MINUTES} minutes planned.
      </p>
      <span className="sh-summary__meter" aria-hidden="true">
        <span style={{ inlineSize: `${Math.min(100, (total / HOUR_MINUTES) * 100)}%` }} />
      </span>
      {rituals.length ? (
        <ol className="sh-summary__list">
          {rituals.map((entry) => (
            <li key={entry.id}>
              <span>{ritualById(entry.id).title}</span>
              <span className="sh-summary__minutes">{entry.minutes} min</span>
            </li>
          ))}
        </ol>
      ) : null}
      {children}
    </div>
  );
}

/** "Check your hour": one link per invalid field, each moving focus to that field. */
export const CheckYourHour = forwardRef<HTMLDivElement, { prefix: string; errors: FieldErrors }>(function CheckYourHour({ prefix, errors }, ref) {
  const fields = FIELD_ORDER.filter((field) => errors[field]);
  if (!fields.length) return null;
  return (
    <div className="sh-check-alert" role="alert" tabIndex={-1} ref={ref} aria-labelledby={`${prefix}-check-title`}>
      <h3 className="sh-check-alert__title" id={`${prefix}-check-title`}>
        Check your hour
      </h3>
      <ul className="sh-check-alert__list" role="list">
        {fields.map((field) => (
          <li key={field}>
            <a
              href={`#${fieldId(prefix, field)}`}
              onClick={(event) => {
                event.preventDefault();
                focusField(prefix, field);
              }}
            >
              {FIELD_LABELS[field]}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
});
