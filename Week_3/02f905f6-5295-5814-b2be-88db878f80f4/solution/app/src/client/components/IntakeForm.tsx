// The intake fields shared by member Intake and the Counter drop-off: shape, units, sizes, clay,
// plan and cone, the live fee estimate and the photo that counts only once storage confirms it.
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Clay, Plan, Quote, Unit } from "../../shared/api";
import type { Shape } from "../../shared/rules";
import { request, uploadPhoto } from "../api";
import { convertSize, money, PLAN_LABELS } from "../format";
import { CameraIcon } from "./Icons";

interface Draft {
  shape: Shape;
  unit: Unit;
  length: string;
  width: string;
  diameter: string;
  height: string;
  clayId: string;
  plan: Plan;
  cone: string;
}

type SizeName = "length" | "width" | "diameter" | "height";

const START: Draft = { shape: "rectangular", unit: "in", length: "", width: "", diameter: "", height: "", clayId: "", plan: "bisque_and_glaze", cone: "" };

type Estimate = { kind: "incomplete"; notes: string[] } | { kind: "pending" } | { kind: "ready"; quote: Quote };
type PhotoState = { kind: "none" } | { kind: "uploading" } | { kind: "attached"; id: string } | { kind: "error"; message: string };

const sizeNames = (shape: Shape): SizeName[] => (shape === "rectangular" ? ["length", "width", "height"] : ["diameter", "height"]);
const SIZE_LABELS: Record<SizeName, string> = { length: "Length", width: "Width", diameter: "Diameter", height: "Height" };
const QUOTE_DELAY_MS = 250;

/** The Fee estimate sentence, with its figures set in the numeral face. */
function EstimateCopy({ estimate }: { estimate: Estimate }) {
  if (estimate.kind === "pending") return <>Working out the fee…</>;
  if (estimate.kind === "incomplete") return <>Fee appears when every size is filled in</>;
  const { quote } = estimate;
  return (
    <>
      Fee <span className="num">{money(quote.fee_cents)}</span>
      {quote.minimum_applied ? " (order minimum)" : ""} for <span className="num">{quote.cubic_inches}</span> cubic inches
    </>
  );
}

const FIELD_IDS: Record<string, string> = {
  shape: "intake-shape",
  unit: "intake-unit",
  length: "intake-length",
  width: "intake-width",
  diameter: "intake-diameter",
  height: "intake-height",
  clay_id: "intake-clay",
  plan: "intake-plan",
  cone: "intake-cone",
  photo_id: "intake-photo",
  guest_name: "guest-name",
  guest_email: "guest-email",
};

export const fieldId = (key: string) => FIELD_IDS[key] ?? "intake-shape";

/** Draft, live estimate, photo, field errors and the Idempotency-Key that lives until the form changes. */
export function useIntake() {
  const [draft, setDraftState] = useState<Draft>(START);
  const [estimate, setEstimate] = useState<Estimate>({ kind: "incomplete", notes: [] });
  const [photo, setPhoto] = useState<PhotoState>({ kind: "none" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [clays, setClays] = useState<Clay[]>([]);
  const key = useRef<string | null>(null);
  const asked = useRef(0);

  useEffect(() => {
    void request<Clay[]>("GET", "/api/clays").then((result) => result.ok && setClays(result.data));
  }, []);

  const setDraft = (change: Partial<Draft>) => {
    key.current = null;
    setDraftState((current) => ({ ...current, ...change }));
  };

  const { shape, unit, length, width, diameter, height, plan } = draft;
  useEffect(() => {
    const names = sizeNames(shape);
    const values = { length, width, diameter, height };
    const ticket = ++asked.current;
    if (names.some((name) => values[name].trim() === "")) {
      setEstimate({ kind: "incomplete", notes: [] });
      return;
    }
    const timer = setTimeout(async () => {
      setEstimate({ kind: "pending" });
      const body: Record<string, string> = { shape, unit, plan };
      for (const name of names) body[name] = values[name];
      const result = await request<Quote>("POST", "/api/quote", body);
      if (ticket !== asked.current) return;
      if (result.ok) setEstimate({ kind: "ready", quote: result.data });
      else setEstimate({ kind: "incomplete", notes: Object.entries(result.error?.fields ?? {}).map(([k, m]) => `${SIZE_LABELS[k as SizeName] ?? k}: ${m}`) });
    }, QUOTE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [shape, unit, length, width, diameter, height, plan]);

  const switchUnit = (next: Unit) => {
    if (next === draft.unit) return;
    setDraft({
      unit: next,
      length: convertSize(draft.length, next),
      width: convertSize(draft.width, next),
      diameter: convertSize(draft.diameter, next),
      height: convertSize(draft.height, next),
    });
  };

  const choosePhoto = async (file: File | undefined) => {
    key.current = null;
    if (!file) {
      setPhoto({ kind: "none" });
      return;
    }
    setPhoto({ kind: "uploading" });
    const result = await uploadPhoto(file);
    if (result.ok) setPhoto({ kind: "attached", id: result.data.photo_id });
    else if (result.status === 415) setPhoto({ kind: "error", message: "Use a JPEG, PNG, WebP or HEIC photo" });
    else if (result.status === 413) setPhoto({ kind: "error", message: "Photo is over 8,000,000 bytes" });
    else setPhoto({ kind: "error", message: "Photo not saved — storage is unreachable. Try again in a minute." });
  };

  const body = (): Record<string, unknown> => {
    const out: Record<string, unknown> = {
      shape: draft.shape,
      unit: draft.unit,
      plan: draft.plan,
      clay_id: draft.clayId || null,
      cone: draft.plan === "bisque_only" ? null : draft.cone || null,
      photo_id: photo.kind === "attached" ? photo.id : null,
    };
    for (const name of sizeNames(draft.shape)) out[name] = draft[name];
    return out;
  };

  /** The key for this submission: reused by a retry until the form changes. */
  const submissionKey = () => {
    key.current ??= crypto.randomUUID();
    return key.current;
  };

  const reset = () => {
    key.current = null;
    setDraftState((current) => ({ ...START, unit: current.unit }));
    setPhoto({ kind: "none" });
    setErrors({});
  };

  const ready = photo.kind === "attached" && estimate.kind === "ready";
  return { draft, setDraft, switchUnit, estimate, photo, choosePhoto, errors, setErrors, clays, body, submissionKey, reset, ready };
}

type Intake = ReturnType<typeof useIntake>;

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? (
    <p className="field-error" id={`${id}-error`}>
      {message}
    </p>
  ) : null;
}

const described = (id: string, message?: string) =>
  message ? { "aria-invalid": true as const, "aria-describedby": `${id}-error` } : {};

function Choices<T extends string>({ label, id, value, options, onChange, error }: { label: string; id: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; error?: string }) {
  return (
    <div className="field">
      <span className="label" id={`${id}-label`}>
        {label}
      </span>
      <div className="choices" role="radiogroup" aria-labelledby={`${id}-label`} {...described(id, error)}>
        {options.map((option, index) => (
          <label className="choice" key={option.value}>
            <input
              type="radio"
              id={index === 0 ? id : `${id}-${option.value}`}
              name={id}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            {option.label}
          </label>
        ))}
      </div>
      <FieldError id={id} message={error} />
    </div>
  );
}

export function IntakeFields({ intake }: { intake: Intake }) {
  const { draft, setDraft, switchUnit, errors, clays } = intake;
  const sizes = sizeNames(draft.shape);
  return (
    <>
      <Choices
        label="Shape"
        id="intake-shape"
        value={draft.shape}
        options={[
          { value: "round", label: "Round" },
          { value: "rectangular", label: "Rectangular" },
          { value: "plate", label: "Plate" },
        ]}
        onChange={(shape) => setDraft({ shape })}
        error={errors.shape}
      />
      <Choices
        label="Units"
        id="intake-unit"
        value={draft.unit}
        options={[
          { value: "in", label: "in" },
          { value: "cm", label: "cm" },
        ]}
        onChange={switchUnit}
        error={errors.unit}
      />
      <div className="sizes">
        {sizes.map((name) => (
          <div className="field" key={name}>
            <label htmlFor={FIELD_IDS[name]}>{SIZE_LABELS[name]}</label>
            <div className="unit-input">
              <input
                id={FIELD_IDS[name]}
                className="input num"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={draft[name]}
                onChange={(event) => setDraft({ [name]: event.target.value })}
                {...described(FIELD_IDS[name], errors[name])}
              />
              <span className="unit" aria-hidden="true">
                {draft.unit}
              </span>
            </div>
            <FieldError id={FIELD_IDS[name]} message={errors[name]} />
          </div>
        ))}
      </div>
      {draft.shape === "plate" ? <p className="hint">A plate counts as at least 1.5 in tall.</p> : null}
      <div className="field">
        <label htmlFor="intake-clay">Clay body</label>
        <select id="intake-clay" className="select" value={draft.clayId} onChange={(e) => setDraft({ clayId: e.target.value })} {...described("intake-clay", errors.clay_id)}>
          <option value="">Choose a clay body</option>
          {clays.map((clay) => (
            <option key={clay.id} value={clay.id}>
              {clay.name}
            </option>
          ))}
        </select>
        <FieldError id="intake-clay" message={errors.clay_id} />
      </div>
      <div className="field">
        <label htmlFor="intake-plan">Firing plan</label>
        <select id="intake-plan" className="select" value={draft.plan} onChange={(e) => setDraft({ plan: e.target.value as Plan })} {...described("intake-plan", errors.plan)}>
          {(Object.keys(PLAN_LABELS) as Plan[]).map((plan) => (
            <option key={plan} value={plan}>
              {PLAN_LABELS[plan]}
            </option>
          ))}
        </select>
        <FieldError id="intake-plan" message={errors.plan} />
      </div>
      <div className="field">
        <label htmlFor="intake-cone">Glaze cone</label>
        <select
          id="intake-cone"
          className="select"
          value={draft.plan === "bisque_only" ? "" : draft.cone}
          disabled={draft.plan === "bisque_only"}
          onChange={(e) => setDraft({ cone: e.target.value })}
          {...described("intake-cone", errors.cone)}
        >
          <option value="">{draft.plan === "bisque_only" ? "No glaze firing" : "Choose a cone"}</option>
          <option value="06">Cone 06</option>
          <option value="6">Cone 6</option>
        </select>
        <FieldError id="intake-cone" message={errors.cone} />
      </div>
    </>
  );
}

const PHOTO_COPY: Record<PhotoState["kind"], string> = {
  none: "No photo yet",
  uploading: "Uploading photo…",
  attached: "Photo attached",
  error: "",
};

export function PhotoField({ intake }: { intake: Intake }) {
  const { photo, choosePhoto, errors } = intake;
  const message = photo.kind === "error" ? photo.message : PHOTO_COPY[photo.kind];
  return (
    <div className="field photo-field">
      <div className="photo-pick">
        <CameraIcon />
        <label htmlFor="intake-photo" className="label">
          Intake photo
        </label>
        <span className="hint" id="intake-photo-hint">
          Take one with the camera or choose a JPEG, PNG, WebP or HEIC file up to 8 MB.
        </span>
        <input
          id="intake-photo"
          className="photo-input"
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/*"
          capture="environment"
          aria-describedby={errors.photo_id ? "intake-photo-error intake-photo-hint" : "intake-photo-hint"}
          aria-invalid={errors.photo_id ? true : undefined}
          onChange={(event) => void choosePhoto(event.target.files?.[0])}
        />
      </div>
      <p role="status" aria-label="Photo upload" className={`result ${photo.kind === "error" ? "is-error" : photo.kind === "attached" ? "is-ok" : "muted"}`}>
        {message}
      </p>
      {photo.kind === "attached" ? (
        <figure className="photo-frame photo-preview">
          <div className="photo-mat">
            <img src={`/api/photos/${photo.id}`} alt="The stored intake photo" />
          </div>
          <figcaption className="photo-caption">Intake photo · stored, numbered on acceptance</figcaption>
        </figure>
      ) : null}
      <FieldError id="intake-photo" message={errors.photo_id} />
    </div>
  );
}

export function FeePanel({ estimate, pinned, children }: { estimate: Estimate; pinned?: boolean; children?: ReactNode }) {
  const quote = estimate.kind === "ready" ? estimate.quote : null;
  const sides = quote ? (["length", "width", "diameter", "height"] as const).filter((k) => quote.sides_in[k] !== undefined) : [];
  return (
    <section className={`fee-panel stub${pinned ? " pinned" : ""}`} aria-labelledby="fee-title">
      <h2 id="fee-title" className="fee-title">
        Fee
      </h2>
      <p role="status" aria-label="Fee estimate" className={`fee-estimate${estimate.kind === "incomplete" ? " muted" : ""}`}>
        <EstimateCopy estimate={estimate} />
      </p>
      {estimate.kind === "incomplete" && estimate.notes.length > 0 ? (
        <ul className="fee-notes">
          {estimate.notes.map((note) => (
            <li key={note} className="field-error">
              {note}
            </li>
          ))}
        </ul>
      ) : null}
      <dl className="fee-lines">
        <div>
          <dt>Rounded sides</dt>
          <dd>
            {quote
              ? sides.map((k, i) => (
                  <span key={k}>
                    {i > 0 ? " × " : ""}
                    <span className="num">{quote.sides_in[k]} in</span>
                  </span>
                ))
              : "—"}
          </dd>
        </div>
        <div>
          <dt>Volume</dt>
          <dd>{quote ? <span className="num">{quote.cubic_inches} in³</span> : "—"}</dd>
        </div>
        <div>
          <dt>Rate</dt>
          <dd>{quote ? <span className="num">${quote.rate_per_cubic_inch} per in³</span> : "—"}</dd>
        </div>
        <div>
          <dt>Discount</dt>
          <dd>{quote ? <span className="num">{quote.discount_percent}%</span> : "—"}</dd>
        </div>
        <div>
          <dt>Order minimum</dt>
          <dd>
            {quote ? (
              <>
                <span className="num">{money(quote.order_minimum_cents)}</span> {quote.minimum_applied ? "applied" : "not needed"}
              </>
            ) : (
              "—"
            )}
          </dd>
        </div>
        <div className="fee-total">
          <dt>Fee</dt>
          <dd>{quote ? <span className="num-strong">{money(quote.fee_cents)}</span> : "—"}</dd>
        </div>
      </dl>
      {children}
    </section>
  );
}
