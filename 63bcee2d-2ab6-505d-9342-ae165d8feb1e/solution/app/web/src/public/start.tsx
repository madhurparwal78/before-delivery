import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { post } from "../api";
import { NETWORK_FAILURE } from "../office/copy";
import { ErrorSummary, SelectField, TextField, type Errors } from "../office/fields";
import { navigate, useQuery } from "../router";
import { PageHeading } from "./heading";
import { RollLabel, useNotices } from "./shell";

// The three-step enquiry. The step lives in ?step=, every keystroke saves the draft in this tab's session
// storage, and each step is checked by the server's own enquiry validation before moving on.

const DRAFT_KEY = "plumbline-enquiry-draft";
const FORM = "enquiry";
const STEPS = ["Step 1 of 3: About you", "Step 2 of 3: The rollout", "Step 3 of 3: Your message"];
const STEP_FIELDS = [["name", "company", "email", "phone"], ["sector", "region", "sites", "openingMonth"], ["message"]];

type Draft = Record<"name" | "company" | "email" | "phone" | "sector" | "region" | "sites" | "openingMonth" | "message", string>;
const EMPTY: Draft = { name: "", company: "", email: "", phone: "", sector: "", region: "", sites: "", openingMonth: "", message: "" };

function readDraft(): Draft {
  try {
    return { ...EMPTY, ...(JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? "{}") as Partial<Draft>) };
  } catch {
    return EMPTY;
  }
}

function payload(draft: Draft): Record<string, unknown> {
  const sites = draft.sites.trim();
  return { ...draft, sites: /^\d+$/.test(sites) ? Number(sites) : sites };
}

export function StartPage() {
  const query = useQuery();
  const notices = useNotices();
  const requested = Number(query.get("step"));
  const step = requested === 2 || requested === 3 ? requested : 1;
  const [draft, setDraft] = useState<Draft>(readDraft);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const heading = useRef<HTMLDivElement>(null);
  const summary = useRef<HTMLDivElement>(null);
  const shownStep = useRef(step);

  useEffect(() => {
    if (query.get("step") !== String(step)) navigate(`/start?step=${step}`, { replace: true });
  }, [query, step]);

  // Moving between steps (Next, Back or the browser's history) puts focus on the new step's heading.
  useLayoutEffect(() => {
    if (shownStep.current === step) return;
    shownStep.current = step;
    heading.current?.querySelector<HTMLElement>("h1")?.focus();
  }, [step]);

  const set = (name: keyof Draft) => (value: string): void => {
    setDraft((current) => {
      const next = { ...current, [name]: value };
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(next));
      return next;
    });
  };

  const refused = (status: number, body: { error: string; errors?: Errors; retryAfterSeconds?: unknown }): void => {
    if (status === 0) notices.alert(NETWORK_FAILURE);
    else if (status === 429) {
      const seconds = Number(body.retryAfterSeconds);
      notices.alert(`You've sent 3 enquiries from ${draft.email.trim()} recently. Please try again in ${seconds === 1 ? "1 second" : `${seconds} seconds`}.`);
    } else if (body.errors) {
      setErrors(body.errors);
      const first = STEP_FIELDS.findIndex((names) => names.some((name) => name in (body.errors ?? {})));
      if (first >= 0 && first + 1 !== step) navigate(`/start?step=${first + 1}`);
      queueMicrotask(() => summary.current?.focus());
    }
  };

  const next = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    const result = await post("/api/enquiries", { ...payload(draft), validateOnly: step });
    setBusy(false);
    if (result.ok) {
      setErrors({});
      navigate(`/start?step=${step + 1}`);
    } else refused(result.status, result.body);
  };

  const send = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    notices.announce("Sending…");
    const result = await post<{ enquiry: { reference: string } }>("/api/enquiries", payload(draft));
    setBusy(false);
    if (result.ok) {
      const copy = `Thanks, ${draft.name}. Your enquiry ${result.data.enquiry.reference} is with our studio.`;
      sessionStorage.removeItem(DRAFT_KEY);
      setErrors({});
      setSent(copy);
      notices.announce(copy);
      return;
    }
    notices.announce("");
    refused(result.status, result.body);
  };

  if (sent) {
    return (
      <section className="section section-plaster start" data-tone="light">
        <div className="grid">
          <p className="sheet-caption"><span>Enquiry</span><span>Received</span></p>
          <SuccessHeading copy={sent} />
          <p className="hero-lede">We have emailed you a copy. A director will reply within two working days.</p>
        </div>
      </section>
    );
  }

  const stepErrors = Object.fromEntries(Object.entries(errors).filter(([name]) => STEP_FIELDS[step - 1].includes(name)));
  return (
    <section className="section section-plaster start" data-tone="light">
      <div className="grid">
        <form className="enquiry" aria-labelledby="enquiry-form-title" noValidate onSubmit={(event) => {
          event.preventDefault();
          void (step === 3 ? send() : next());
        }}>
          <p className="sheet-caption" id="enquiry-form-title"><span>Start a project</span></p>
          <ol className="step-track" aria-hidden="true">
            {STEPS.map((label, index) => <li key={label} className={index + 1 === step ? "is-current" : index + 1 < step ? "is-done" : ""}>{String(index + 1).padStart(2, "0")}</li>)}
          </ol>
          <div ref={heading}>
            <PageHeading key={step} title="Start a project · Marrow Hall Interiors" lines={[STEPS[step - 1]]} className="step-heading" />
          </div>
          <div ref={summary} tabIndex={-1} className="summary-anchor">
            <ErrorSummary errors={stepErrors} form={FORM} />
          </div>
          {step === 1 && (
            <div className="field-grid">
              <TextField form={FORM} name="name" label="Your name" value={draft.name} onChange={set("name")} error={errors.name} autoComplete="name" />
              <TextField form={FORM} name="company" label="Company" value={draft.company} onChange={set("company")} error={errors.company} autoComplete="organization" />
              <TextField form={FORM} name="email" label="Email" type="email" value={draft.email} onChange={set("email")} error={errors.email} autoComplete="email" />
              <TextField form={FORM} name="phone" label="Phone (optional)" value={draft.phone} onChange={set("phone")} error={errors.phone} autoComplete="tel" />
            </div>
          )}
          {step === 2 && (
            <div className="field-grid">
              <SelectField form={FORM} name="sector" label="Sector" value={draft.sector} onChange={set("sector")} error={errors.sector}
                placeholder="Choose a sector" options={[{ value: "retail", label: "Retail" }, { value: "workplace", label: "Workplace" }, { value: "food_beverage", label: "Food & beverage" }]} />
              <SelectField form={FORM} name="region" label="Region" value={draft.region} onChange={set("region")} error={errors.region}
                placeholder="Choose a region" options={[{ value: "HK", label: "Hong Kong" }, { value: "SG", label: "Singapore" }, { value: "MO", label: "Macao" }]} />
              <TextField form={FORM} name="sites" label="Number of sites" type="number" value={draft.sites} onChange={set("sites")} error={errors.sites} />
              <TextField form={FORM} name="openingMonth" label="Target opening month" type="month" value={draft.openingMonth} onChange={set("openingMonth")}
                error={errors.openingMonth} hint="Year and month, for example 2027-03" />
            </div>
          )}
          {step === 3 && (
            <TextField form={FORM} name="message" label="Tell us about the rollout" multiline value={draft.message} onChange={set("message")} error={errors.message} />
          )}
          <div className="step-actions">
            {step > 1 && <button type="button" className="secondary" onClick={() => navigate(`/start?step=${step - 1}`)}>Back</button>}
            {step < 3 ? (
              <button type="submit" className="secondary next" aria-disabled={busy || undefined}>Next</button>
            ) : (
              <button type="submit" className="primary roll" aria-disabled={busy || undefined}>
                {busy ? "Sending…" : <RollLabel label="Send enquiry" />}
              </button>
            )}
          </div>
        </form>
      </div>
    </section>
  );
}

function SuccessHeading({ copy }: { copy: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => ref.current?.focus(), []);
  return <h1 ref={ref} tabIndex={-1} className="page-heading">{copy}</h1>;
}
