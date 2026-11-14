import { type ChangeEvent, type FormEvent, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  type AnswerField, BUDGETS, characterCount, DESCRIPTION_MAX, ENQUIRY_STEPS, fieldError, limitMessage, validateFields,
} from "../../shared/enquiry-rules";
import { belongsToService } from "../../shared/prices";
import type { EnquiryAnswers, FieldErrors } from "../../shared/types";
import { boot, catalog } from "../boot";
import { focusClear } from "../focus";
import { Link, navigate, useLocation } from "../router";
import { DRAFT_KEY, readJson, writeJson } from "../storage";

const REVIEW = ENQUIRY_STEPS.length;
const STEP_NAMES = [...ENQUIRY_STEPS.map((step) => step.name), "Review"];
const RULES = { services: catalog.services, prices: catalog.prices };
/** The step that holds the `Service` radio group: an address that pre-fills the service opens on it (DP-41, L559). */
const SERVICE_STEP = ENQUIRY_STEPS.findIndex((step) => (step.fields as readonly string[]).includes("service"));

interface Draft {
  answers: EnquiryAnswers;
  step: number;
  submissionId: string | null;
  appliedQuery: string;
}

const emptyDraft = (appliedQuery = ""): Draft => ({
  answers: { name: "", email: "", business_name: "", service: "", description: "", budget: "", item: null },
  step: 0,
  submissionId: null,
  appliedQuery,
});

/** The draft kept in this tab, with the address's service and item applied once per address. Applying them opens
 * step 2, where the service is chosen; a review's submission id is discarded, as on leaving Review for another step. */
function loadDraft(search: string): Draft {
  const draft = readJson<Draft>(DRAFT_KEY) ?? emptyDraft();
  if (search === draft.appliedQuery) return draft;
  const params = new URLSearchParams(search);
  const service = catalog.services.find((candidate) => candidate.id === params.get("service"));
  if (!service) return draft;
  const item = catalog.prices.find((candidate) => candidate.id === params.get("item") && belongsToService(candidate, service.id));
  const kept = draft.answers.service === service.id ? draft.answers.item : null;
  return {
    ...draft, appliedQuery: search, step: SERVICE_STEP, submissionId: null,
    answers: { ...draft.answers, service: service.id, item: item?.id ?? kept },
  };
}

/** A version 4 UUID from the browser's random source (available on every origin, unlike `crypto.randomUUID`). */
function newSubmissionId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function itemName(id: string | null): string | undefined {
  return catalog.prices.find((candidate) => candidate.id === id)?.name;
}

const FIELD_IDS: Record<AnswerField, string> = {
  name: "enquiry-name", email: "enquiry-email", business_name: "enquiry-business", service: "enquiry-service",
  description: "enquiry-description", budget: "enquiry-budget", item: "enquiry-item",
};

function TextField({ field, label, type = "text", value, error, onChange, autoComplete }: {
  field: AnswerField; label: string; type?: string; value: string; error: string | undefined; onChange: (event: ChangeEvent<HTMLInputElement>) => void; autoComplete: string;
}) {
  const id = FIELD_IDS[field];
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} name={field} type={type} value={value} onChange={onChange} autoComplete={autoComplete} {...(error ? { "aria-invalid": true, "aria-describedby": `${id}-error` } : {})} />
      {error && <p id={`${id}-error`} className="field-error">{error}</p>}
    </div>
  );
}

function RadioGroup({ field, label, options, value, error, onChange }: {
  field: "service" | "budget"; label: string; options: { id: string; label: string }[]; value: string; error: string | undefined; onChange: (id: string) => void;
}) {
  const id = FIELD_IDS[field];
  return (
    <div className="field">
      <p id={`${id}-label`} className="group-label" aria-hidden="true">{label}</p>
      <div role="radiogroup" id={id} aria-labelledby={`${id}-label`} className="radio-list" {...(error ? { "aria-invalid": true, "aria-describedby": `${id}-error` } : {})}>
        {options.map((option) => (
          <label key={option.id} className="radio">
            <input type="radio" name={field} value={option.id} checked={value === option.id} onChange={() => onChange(option.id)} />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
      {error && <p id={`${id}-error`} className="field-error">{error}</p>}
    </div>
  );
}

function AttachedItem({ name, onRemove }: { name: string; onRemove: () => void }) {
  return (
    <p className="attached">
      <span>Enquiring about: {name}</span>
      <button type="button" className="button button--quiet" onClick={onRemove}>Remove item</button>
    </p>
  );
}

type Notice = { kind: "failed" } | { kind: "limited"; text: string } | null;

export function ContactPage() {
  const location = useLocation();
  const [draft, setDraft] = useState(() => loadDraft(location.search));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [received, setReceived] = useState<{ name: string; reference: string; intakeReference: string } | null>(null);
  const [moved, setMoved] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const retry = useRef<HTMLButtonElement>(null);
  const alert = useRef<HTMLDivElement>(null);
  const { answers, step } = draft;

  const keep = (next: Draft) => {
    setDraft(next);
    writeJson(DRAFT_KEY, next);
  };

  useLayoutEffect(() => {
    if (moved > 0) focusClear(heading.current);
  }, [moved]);

  const goTo = (target: number) => {
    const submissionId = target === REVIEW ? (draft.submissionId ?? newSubmissionId()) : null;
    keep({ ...draft, step: target, submissionId });
    setNotice(null);
    setMoved((count) => count + 1);
  };

  const setAnswer = <K extends keyof EnquiryAnswers>(field: K, value: EnquiryAnswers[K], extra: Partial<EnquiryAnswers> = {}) => {
    const nextAnswers = { ...answers, [field]: value, ...extra };
    keep({ ...draft, answers: nextAnswers });
    if (field !== "item" && errors[field] && !fieldError(field, nextAnswers, RULES)) {
      const { [field]: _removed, ...rest } = errors;
      setErrors(rest);
    }
  };

  const chooseService = (id: string) => {
    const attachedItem = catalog.prices.find((price) => price.id === answers.item);
    const detach = attachedItem !== undefined && !belongsToService(attachedItem, id);
    if (!detach) {
      setAnswer("service", id);
      return;
    }
    const search = dropItemFromAddress();  // the shortened address is applied: a reload keeps the chosen service
    keep({ ...draft, appliedQuery: search, answers: { ...answers, service: id, item: null } });
    if (errors.service) {
      const { service: _removed, ...rest } = errors;
      setErrors(rest);
    }
  };

  const dropItemFromAddress = () => {
    const params = new URLSearchParams(location.search);
    params.delete("item");
    const search = params.toString() ? `?${params}` : "";
    navigate(`/contact${search}`, { replace: true });
    return search;
  };

  const removeItem = () => {
    const search = dropItemFromAddress();
    keep({ ...draft, appliedQuery: search, answers: { ...answers, item: null } });
  };

  const firstInvalid = (found: FieldErrors, fields: readonly AnswerField[]): HTMLElement | null => {
    const field = fields.find((candidate) => found[candidate]);
    if (!field) return null;
    const element = form.current?.querySelector<HTMLElement>(field === "service" || field === "budget" ? `input[name="${field}"]` : `[name="${field}"]`);
    return element ?? null;
  };

  const next = () => {
    const fields: readonly AnswerField[] = ENQUIRY_STEPS[step]?.fields ?? [];
    const found = validateFields(fields, answers, RULES);
    if (Object.keys(found).length === 0) {
      setErrors((current) => Object.fromEntries(Object.entries(current).filter(([field]) => !fields.includes(field as AnswerField))));
      goTo(step + 1);
      return;
    }
    flushSync(() => setErrors((current) => ({ ...current, ...found })));
    focusClear(firstInvalid(found, fields));
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (step < REVIEW) next();
    else void send();
  };

  const send = async () => {
    if (sending) return;
    flushSync(() => {
      setSending(true);
      setNotice(null);
    });
    try {
      const response = await fetch("/api/enquiries", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...answers, submission_id: draft.submissionId }) });
      if (response.status === 201) {
        const body = (await response.json()) as { reference: string; intake_reference: string };
        sessionStorage.removeItem(DRAFT_KEY);
        flushSync(() => {
          setSending(false);
          setReceived({ name: answers.name, reference: body.reference, intakeReference: body.intake_reference });
        });
        focusClear(heading.current);
      } else if (response.status === 422) {
        const body = (await response.json()) as { errors: FieldErrors };
        const earliest = ENQUIRY_STEPS.findIndex((candidate) => candidate.fields.some((field) => body.errors[field]));
        flushSync(() => {
          setSending(false);
          setErrors(body.errors);
        });
        keep({ ...draft, step: Math.max(0, earliest), submissionId: null });
        setMoved((count) => count + 1);
      } else if (response.status === 429) {
        const body = (await response.json()) as { retry_after_seconds: number };
        flushSync(() => {
          setSending(false);
          setNotice({ kind: "limited", text: limitMessage(boot.enquiryLimit, boot.enquiryWindowSeconds, body.retry_after_seconds) });
        });
        focusClear(alert.current);
      } else {
        throw new Error("hand-off failed");
      }
    } catch {
      flushSync(() => {
        setSending(false);
        setNotice({ kind: "failed" });
      });
      focusClear(retry.current);
    }
  };

  const startAnother = () => {
    sessionStorage.removeItem(DRAFT_KEY);
    flushSync(() => {
      setDraft(emptyDraft(location.search));
      setReceived(null);
      setErrors({});
      setNotice(null);
    });
    focusClear(heading.current);
  };

  const text = (field: "name" | "email" | "business_name" | "description") => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setAnswer(field, event.target.value);
  const serviceName = catalog.services.find((service) => service.id === answers.service)?.name ?? "";
  const budgetLabel = BUDGETS.find((budget) => budget.id === answers.budget)?.label ?? "";
  const attached = itemName(answers.item);

  return (
    <section className="page page--form" data-section="contact">
      <h1 tabIndex={-1}>Start a project</h1>
      <p className="lede prose">Tell us about your business and the work you have in mind. Vellum Orbit is a fictional studio, so this form is a working demonstration: nothing you send reaches a real business.</p>
      {received ? (
        <div className="received">
          <h2 tabIndex={-1} ref={heading}>Enquiry received</h2>
          <p>Thank you, {received.name}. Your enquiry {received.reference} was recorded and handed to the studio's intake service as {received.intakeReference}.</p>
          <p>Vellum Orbit Studio is fictional, so no one will contact you.</p>
          <p className="panel-links">
            <Link className="button button--quiet" href="/">Back to the worlds</Link>
            <button type="button" className="button button--primary" onClick={startAnother}>Start another enquiry</button>
          </p>
          <div role="status" aria-label="Enquiry status" className="status" />
        </div>
      ) : (
        <>
          <ol className="step-list" aria-label="Enquiry steps">
            {STEP_NAMES.map((name, at) => <li key={name} aria-current={at === step ? "step" : undefined}>{name}</li>)}
          </ol>
          <form ref={form} noValidate onSubmit={onSubmit} className="enquiry-form">
            <h2 tabIndex={-1} ref={heading}>Step {step + 1} of 4: {STEP_NAMES[step]}</h2>
            {step === 0 && (
              <>
                <TextField field="name" label="Name" value={answers.name} error={errors.name} onChange={text("name")} autoComplete="name" />
                <TextField field="email" label="Email" type="email" value={answers.email} error={errors.email} onChange={text("email")} autoComplete="email" />
                <TextField field="business_name" label="Business name" value={answers.business_name} error={errors.business_name} onChange={text("business_name")} autoComplete="organization" />
              </>
            )}
            {step === 1 && (
              <>
                <RadioGroup field="service" label="Service" options={catalog.services.map((service) => ({ id: service.id, label: service.name }))} value={answers.service} error={errors.service} onChange={chooseService} />
                {attached && <AttachedItem name={attached} onRemove={removeItem} />}
                <div className="field">
                  <label htmlFor="enquiry-description">Project description</label>
                  <textarea id="enquiry-description" name="description" rows={7} value={answers.description} onChange={text("description")} aria-describedby={`enquiry-description-count${errors.description ? " enquiry-description-error" : ""}`} {...(errors.description ? { "aria-invalid": true } : {})} />
                  <p id="enquiry-description-count" className="counter numeric">{characterCount(answers.description).toLocaleString("en-US")} / {DESCRIPTION_MAX.toLocaleString("en-US")} characters</p>
                  {errors.description && <p id="enquiry-description-error" className="field-error">{errors.description}</p>}
                </div>
              </>
            )}
            {step === 2 && <RadioGroup field="budget" label="Approximate budget" options={BUDGETS} value={answers.budget} error={errors.budget} onChange={(id) => setAnswer("budget", id)} />}
            {step === REVIEW && (
              <>
                <dl className="review">
                  <div><dt>Name</dt><dd>{answers.name}</dd></div>
                  <div><dt>Email</dt><dd>{answers.email}</dd></div>
                  <div><dt>Business name</dt><dd>{answers.business_name}</dd></div>
                  <div><dt>Service</dt><dd>{serviceName}</dd></div>
                  {attached && <div><dt>Enquiring about</dt><dd>{attached}</dd></div>}
                  <div><dt>Project description</dt><dd>{answers.description}</dd></div>
                  <div><dt>Approximate budget</dt><dd>{budgetLabel}</dd></div>
                </dl>
                {attached && <AttachedItem name={attached} onRemove={removeItem} />}
                <p className="panel-links">
                  {ENQUIRY_STEPS.map((entry, at) => <button key={entry.id} type="button" className="button button--quiet" onClick={() => goTo(at)}>{entry.edit}</button>)}
                </p>
                <p className="demo-note">This demonstration stores your enquiry and hands it to a stand-in intake service. No real business will receive it.</p>
                {notice?.kind === "failed" && <div role="alert" tabIndex={-1} ref={alert} className="alert">We could not hand your enquiry to the studio's intake service. Your answers are kept. Try again in a moment.</div>}
                {notice?.kind === "limited" && <div role="alert" tabIndex={-1} ref={alert} className="alert">{notice.text}</div>}
              </>
            )}
            <div className="form-actions">
              {step > 0 && <button type="button" className="button button--quiet" disabled={sending} onClick={() => goTo(step - 1)}>Back</button>}
              {step < REVIEW && <button type="submit" className="button button--primary">Next</button>}
              {step === REVIEW && notice?.kind === "failed" && <button type="submit" ref={retry} className="button button--primary" disabled={sending}>{sending ? "Sending…" : "Try again"}</button>}
              {step === REVIEW && notice?.kind !== "failed" && <button type="submit" className="button button--primary" disabled={sending}>{sending ? "Sending…" : "Send enquiry"}</button>}
            </div>
            <div role="status" aria-label="Enquiry status" className="status">{sending ? "Sending your enquiry…" : ""}</div>
          </form>
        </>
      )}
      <p className="email-line">Prefer email? hello@vellumorbit.example is an illustrative address.</p>
    </section>
  );
}
