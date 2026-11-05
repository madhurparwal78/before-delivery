import React, { useEffect, useRef, useState } from "react";
import { api, ApiError, type Clay, type Quote, newIdempotencyKey } from "../api.js";

type Shape = "round" | "rectangular" | "plate";
type Plan = "bisque_and_glaze" | "bisque_only" | "glaze_only";

export interface IntakeFormState {
  shape: Shape;
  unit: "in" | "cm";
  length: string;
  width: string;
  diameter: string;
  height: string;
  plan: Plan;
  clay_id: string;
  cone: string;
}

export const EMPTY_FORM: IntakeFormState = {
  shape: "rectangular",
  unit: "in",
  length: "",
  width: "",
  diameter: "",
  height: "",
  plan: "bisque_and_glaze",
  clay_id: "",
  cone: "6"
};

export function ShapeRadioGroup({ form, onChange }: { form: IntakeFormState; onChange: (patch: Partial<IntakeFormState>) => void }): React.ReactElement {
  return (
    <fieldset className="field">
      <legend>Shape</legend>
      <div className="field-row" role="radiogroup" aria-label="Shape">
        {(["round", "rectangular", "plate"] as const).map((s) => (
          <label key={s} style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", minHeight: "44px" }}>
            <input
              type="radio"
              name="shape"
              value={s}
              checked={form.shape === s}
              onChange={() => onChange({ shape: s })}
            />
            {s === "round" ? "Round" : s === "rectangular" ? "Rectangular" : "Plate"}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function UnitsRadioGroup({ form, onChange }: { form: IntakeFormState; onChange: (patch: Partial<IntakeFormState>) => void }): React.ReactElement {
  return (
    <fieldset className="field">
      <legend>Units</legend>
      <div className="field-row" role="radiogroup" aria-label="Units">
        {(["in", "cm"] as const).map((u) => (
          <label key={u} style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", minHeight: "44px" }}>
            <input
              type="radio"
              name="unit"
              value={u}
              checked={form.unit === u}
              onChange={() => {
                // Convert typed values between units: in × 2.54, cm ÷ 2.54.
                const toCm = u === "cm";
                const conv = (v: string): string => {
                  if (!v) return "";
                  const n = Number(v);
                  if (!Number.isFinite(n)) return v;
                  const out = toCm ? n * 2.54 : n / 2.54;
                  return out.toFixed(2);
                };
                onChange({
                  unit: u,
                  length: conv(form.length),
                  width: conv(form.width),
                  diameter: conv(form.diameter),
                  height: conv(form.height)
                });
              }}
            />
            {u === "in" ? "in" : "cm"}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function SizeFields({ form, onChange, errors }: { form: IntakeFormState; onChange: (patch: Partial<IntakeFormState>) => void; errors: Record<string, string> }): React.ReactElement {
  const unitLabel = form.unit === "in" ? "in" : "cm";
  return (
    <div className="field-row">
      {form.shape === "rectangular" ? (
        <>
          <div className="field">
            <label htmlFor="size-length">Length ({unitLabel})</label>
            <input
              id="size-length"
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              aria-label={`Length in ${unitLabel}`}
              value={form.length}
              onChange={(e) => onChange({ length: e.target.value })}
            />
            {errors.length ? <p className="error-text" id="err-length">{errors.length}</p> : null}
          </div>
          <div className="field">
            <label htmlFor="size-width">Width ({unitLabel})</label>
            <input
              id="size-width"
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              aria-label={`Width in ${unitLabel}`}
              value={form.width}
              onChange={(e) => onChange({ width: e.target.value })}
            />
            {errors.width ? <p className="error-text" id="err-width">{errors.width}</p> : null}
          </div>
        </>
      ) : (
        <div className="field">
          <label htmlFor="size-diameter">Diameter ({unitLabel})</label>
          <input
            id="size-diameter"
            type="number"
            step="0.01"
            min="0"
            inputMode="decimal"
            aria-label={`Diameter in ${unitLabel}`}
            value={form.diameter}
            onChange={(e) => onChange({ diameter: e.target.value })}
          />
          {errors.diameter ? <p className="error-text" id="err-diameter">{errors.diameter}</p> : null}
        </div>
      )}
      <div className="field">
        <label htmlFor="size-height">Height ({unitLabel})</label>
        <input
          id="size-height"
          type="number"
          step="0.01"
          min="0"
          inputMode="decimal"
          aria-label={`Height in ${unitLabel}`}
          value={form.height}
          onChange={(e) => onChange({ height: e.target.value })}
        />
        {errors.height ? <p className="error-text" id="err-height">{errors.height}</p> : null}
      </div>
    </div>
  );
}

export function PlanAndClay({ form, onChange, clays, errors }: { form: IntakeFormState; onChange: (patch: Partial<IntakeFormState>) => void; clays: Clay[]; errors: Record<string, string> }): React.ReactElement {
  const glazeDisabled = form.plan === "bisque_only";
  return (
    <div className="field-row">
      <div className="field">
        <label htmlFor="clay-body">Clay body</label>
        <select id="clay-body" aria-label="Clay body" value={form.clay_id} onChange={(e) => onChange({ clay_id: e.target.value })}>
          <option value="">Choose a clay body</option>
          {clays.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {errors.clay_id ? <p className="error-text">{errors.clay_id}</p> : null}
      </div>
      <div className="field">
        <label htmlFor="firing-plan">Firing plan</label>
        <select id="firing-plan" aria-label="Firing plan" value={form.plan} onChange={(e) => onChange({ plan: e.target.value as Plan })}>
          <option value="bisque_and_glaze">Bisque and glaze</option>
          <option value="bisque_only">Bisque only</option>
          <option value="glaze_only">Glaze only</option>
        </select>
        {errors.plan ? <p className="error-text">{errors.plan}</p> : null}
      </div>
      <div className="field">
        <label htmlFor="glaze-cone">Glaze cone</label>
        <select id="glaze-cone" aria-label="Glaze cone" value={glazeDisabled ? "" : form.cone} disabled={glazeDisabled} onChange={(e) => onChange({ cone: e.target.value })}>
          <option value="">Choose</option>
          <option value="06">Cone 06</option>
          <option value="6">Cone 6</option>
        </select>
        {errors.cone ? <p className="error-text">{errors.cone}</p> : null}
      </div>
    </div>
  );
}

export function PhotoPicker({ onUploaded, onStateChange, idPrefix = "" }: { onUploaded: (photoId: string) => void; onStateChange: (state: "idle" | "uploading" | "attached" | "error", message?: string) => void; idPrefix?: string }): React.ReactElement {
  const [state, setState] = useState<"idle" | "uploading" | "attached" | "error">("idle");
  const [message, setMessage] = useState<string>("");

  const upload = async (file: File) => {
    setState("uploading");
    setMessage("Uploading photo…");
    onStateChange("uploading", "Uploading photo…");
    const form = new FormData();
    form.append("photo", file);
    try {
      const data = await api.upload<{ photo_id: string }>("/api/photos", form);
      setState("attached");
      setMessage("Photo attached");
      onStateChange("attached", "Photo attached");
      onUploaded(data.photo_id);
    } catch (err) {
      let msg = "Photo not saved — storage is unreachable. Try again in a minute.";
      if (err instanceof ApiError) {
        if (err.status === 415) msg = "Use a JPEG, PNG, WebP or HEIC photo";
        else if (err.status === 413) msg = "Photo is over 8,000,000 bytes";
        else msg = "Photo not saved — storage is unreachable. Try again in a minute.";
      }
      setState("error");
      setMessage(msg);
      onStateChange("error", msg);
    }
  };

  return (
    <div className="field">
      <label htmlFor={`${idPrefix}intake-photo`}>Intake photo</label>
      <input
        id={`${idPrefix}intake-photo`}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic"
        capture="environment"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      <div className="status-line" role="status" aria-live="polite" aria-label="Photo upload">
        {state === "attached" ? <span className="ok">Photo attached</span> : <span className={state === "error" ? "hazard" : ""}>{message}</span>}
      </div>
    </div>
  );
}

export function FeePanel({ quote, estimateState }: { quote: Quote | null; estimateState: "idle" | "pending" | "error" | "ready" }): React.ReactElement {
  return (
    <div className="pane fee-stub" role="region" aria-label="Fee">
      <h2>Fee</h2>
      <div role="status" aria-live="polite" aria-label="Fee estimate" className="status-line" style={{ minHeight: "3.6em" }}>
        {estimateState === "pending" ? (
          <span>Working out the fee…</span>
        ) : quote ? (
          <div>
            <p className="num">
              {quote.sides_in.length && quote.sides_in.width
                ? `Sides ${quote.sides_in.length} in × ${quote.sides_in.width} in × ${quote.sides_in.height} in`
                : `Diameter ${quote.sides_in.diameter} in × Height ${quote.sides_in.height} in`}
            </p>
            <p className="num">{quote.cubic_inches} in³</p>
            <p className="num">
              Fee {quote.minimum_applied ? `${cents(quote.fee_cents)} (order minimum)` : cents(quote.fee_cents)} for {quote.cubic_inches} cubic inches
            </p>
            <p className="small-note num">
              Rate ${quote.rate_per_cubic_inch} per in³ · discount {quote.discount_percent}%
            </p>
          </div>
        ) : (
          <span>Fee appears when every size is filled in</span>
        )}
      </div>
    </div>
  );
}

import { cents } from "../api.js";

export default function Intake(): React.ReactElement {
  const [form, setForm] = useState<IntakeFormState>(EMPTY_FORM);
  const [clays, setClays] = useState<Clay[]>([]);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [estimateState, setEstimateState] = useState<"idle" | "pending" | "error" | "ready">("idle");
  const [photoId, setPhotoId] = useState<string | null>(null);
  const [photoState, setPhotoState] = useState<"idle" | "uploading" | "attached" | "error">("idle");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ kind: "ok" | "error" | "pending"; text: string } | null>(null);
  const idemKeyRef = useRef<string>(newIdempotencyKey());
  const formRef = useRef(form);
  formRef.current = form;

  useEffect(() => {
    api.get<Clay[]>("/api/clays").then(setClays).catch(() => setClays([]));
  }, []);

  // Live quote: every keystroke, shape, plan or unit change re-quotes.
  useEffect(() => {
    const body = {
      shape: form.shape,
      unit: form.unit,
      length: form.length,
      width: form.width,
      diameter: form.diameter,
      height: form.height,
      plan: form.plan
    };
    const sizesFilled =
      form.height !== "" &&
      (form.shape === "rectangular" ? form.length !== "" && form.width !== "" : form.diameter !== "");
    if (!sizesFilled) {
      setQuote(null);
      setEstimateState("idle");
      return;
    }
    setEstimateState("pending");
    const timer = setTimeout(() => {
      api
        .post<Quote>("/api/quote", body)
        .then((q) => {
          setQuote(q);
          setEstimateState("ready");
        })
        .catch(() => {
          setQuote(null);
          setEstimateState("error");
        });
    }, 60);
    return () => clearTimeout(timer);
  }, [form.shape, form.unit, form.length, form.width, form.diameter, form.height, form.plan]);

  const patch = (p: Partial<IntakeFormState>) => {
    setForm((f) => ({ ...f, ...p }));
    if (idemKeyRef.current) {
      // A retry after a failure reuses the key until the form changes.
    }
  };

  const accept = async () => {
    setResult({ kind: "pending", text: "Saving photo, charge and receipt…" });
    const body = {
      shape: form.shape,
      unit: form.unit,
      length: form.length,
      width: form.width,
      diameter: form.diameter,
      height: form.height,
      plan: form.plan,
      clay_id: form.clay_id,
      cone: form.plan === "bisque_only" ? null : form.cone,
      photo_id: photoId
    };
    try {
      const piece = await api.post<{ number: number; owner: { name: string } }>("/api/intakes", body, idemKeyRef.current);
      setResult({ kind: "ok", text: `Piece ${String(piece.number).padStart(4, "0")} accepted. Receipt sent to ${piece.owner.name}.` });
      setForm(EMPTY_FORM);
      setPhotoId(null);
      setPhotoState("idle");
      setFieldErrors({});
      idemKeyRef.current = newIdempotencyKey();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 422 && err.fields) {
          setFieldErrors(err.fields);
          setResult({ kind: "error", text: "Check these fields" });
        } else if (err.status === 503) {
          setResult({ kind: "error", text: err.message });
        } else {
          setResult({ kind: "error", text: err.message });
        }
      } else {
        setResult({ kind: "error", text: "Something went wrong." });
      }
    }
  };

  const canAccept = photoState === "attached" && quote !== null && estimateState === "ready";

  const errorKeys = Object.keys(fieldErrors);

  return (
    <main>
      <h1>Log a piece</h1>
      <div className="intake-grid">
        <form
          aria-label="Log a piece"
          onSubmit={(e) => {
            e.preventDefault();
            void accept();
          }}
          noValidate
        >
          {errorKeys.length > 0 ? (
            <div className="error-summary" role="alert">
              <h3>Check these fields</h3>
              <ul style={{ margin: 0, paddingLeft: "1.2rem" }}>
                {Object.entries(fieldErrors).map(([k, v]) => (
                  <li key={k}>
                    <a
                      href={`#size-${k}`}
                      onClick={(e) => {
                        e.preventDefault();
                        const el = document.getElementById(`size-${k}`) ?? document.getElementById(k);
                        el?.focus();
                      }}
                    >
                      {v}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <ShapeRadioGroup form={form} onChange={patch} />
          <UnitsRadioGroup form={form} onChange={patch} />
          <SizeFields form={form} onChange={patch} errors={fieldErrors} />
          <PlanAndClay form={form} onChange={patch} clays={clays} errors={fieldErrors} />
          <PhotoPicker
            onUploaded={(id) => {
              setPhotoId(id);
            }}
            onStateChange={(s, _m) => setPhotoState(s)}
          />
          {fieldErrors.photo_id ? <p className="error-text">{fieldErrors.photo_id}</p> : null}
          <button type="submit" className="primary" disabled={!canAccept} style={{ marginTop: "0.5rem" }}>
            Accept and charge
          </button>
          <div role="status" aria-live="polite" aria-label="Intake result" className="status-line" style={{ marginTop: "0.6rem" }}>
            {result ? (
              <span className={result.kind === "ok" ? "ok" : result.kind === "error" ? "hazard" : ""}>{result.text}</span>
            ) : (
              <span className="sr-only">Intake result</span>
            )}
          </div>
        </form>
        <div className="fee-pinned">
          <FeePanel quote={quote} estimateState={estimateState} />
        </div>
      </div>
    </main>
  );
}
