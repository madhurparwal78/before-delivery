import { useEffect, useId, useState } from 'react';
import {
  REGION_LABELS,
  SECTORS,
  SECTOR_LABELS,
  type Region,
  type Sector,
} from '../../../shared/domain.js';
import { fieldErrorCopy } from '../../../shared/fieldErrors.js';
import { ApiError, request } from '../../lib/api.js';
import { useAnnouncer } from '../../lib/announce.jsx';
import { pending, refusal, success } from '../../lib/copy.js';
import {
  clearEnquiryDraft,
  readEnquiryDraft,
  saveEnquiryDraft,
  type DraftValues,
} from '../../lib/drafts.js';
import { useRouter } from '../../lib/router.jsx';
import { PublicShell } from '../../components/PublicShell.jsx';
import { PrimaryButton } from '../../components/Buttons.jsx';
import { ErrorSummary, Field, focusFieldError, useFormErrors } from '../../components/Fields.jsx';
import { focusWhenReady } from '../../lib/focus.js';

interface EnquiryForm {
  name: string;
  company: string;
  email: string;
  phone: string;
  sector: Sector;
  region: Region;
  sites: string;
  openingMonth: string;
  message: string;
}

const EMPTY: EnquiryForm = {
  name: '',
  company: '',
  email: '',
  phone: '',
  sector: 'retail',
  region: 'HK',
  sites: '',
  openingMonth: '',
  message: '',
};

const STEP_HEADINGS = [
  'Step 1 of 3: About you',
  'Step 2 of 3: The rollout',
  'Step 3 of 3: Your message',
];

const STEP_FIELDS: readonly (keyof EnquiryForm)[][] = [
  ['name', 'company', 'email', 'phone'],
  ['sector', 'region', 'sites', 'openingMonth'],
  ['message'],
];

export function Start(): JSX.Element {
  const formId = useId();
  const { startPending, say, problem } = useAnnouncer();
  const { query, navigate } = useRouter();
  const errors = useFormErrors();
  const [form, setForm] = useState<EnquiryForm>(() => {
    const draft = readEnquiryDraft();
    return draft ? { ...EMPTY, ...(draft as Partial<EnquiryForm>) } : EMPTY;
  });
  const [busy, setBusy] = useState(false);
  const [reference, setReference] = useState<string | null>(null);

  const rawStep = Number(query.get('step') ?? '1');
  const step = rawStep === 2 || rawStep === 3 ? rawStep : 1;

  useEffect(() => {
    if (query.get('step') === null) navigate('/start?step=1', { replace: true });
  }, [query, navigate]);

  const update = (changes: Partial<EnquiryForm>): void => {
    const next = { ...form, ...changes };
    setForm(next);
    saveEnquiryDraft(next as unknown as DraftValues);
  };

  /** The fields this step must carry before the next step opens. */
  const refusalsForStep = (which: number): Record<string, string> => {
    const found: Record<string, string> = {};
    if (which === 1) {
      if (form.name.trim() === '') found.name = fieldErrorCopy.required('Your name');
      if (form.company.trim() === '') found.company = fieldErrorCopy.required('Company');
      if (form.email.trim() === '') found.email = fieldErrorCopy.required('Email');
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
        found.email = fieldErrorCopy.badEmail();
      }
    }
    if (which === 2) {
      const sites = Number(form.sites);
      if (form.sites.trim() === '' || !Number.isInteger(sites) || sites < 1 || sites > 200) {
        found.sites = fieldErrorCopy.outOfRange('Number of sites', '1', '200');
      }
      if (!/^\d{4}-\d{2}$/.test(form.openingMonth)) {
        found.openingMonth = fieldErrorCopy.required('Target opening month');
      }
    }
    if (which === 3 && form.message.trim() === '') {
      found.message = fieldErrorCopy.required('Tell us about the rollout');
    }
    return found;
  };

  const goToStep = (next: number): void => {
    navigate(`/start?step=${next}`);
  };

  const onNext = (): void => {
    const found = refusalsForStep(step);
    if (Object.keys(found).length > 0) {
      errors.set(found);
      const first = Object.keys(found)[0];
      if (first) focusFieldError(formId, first);
      return;
    }
    errors.clear();
    goToStep(step + 1);
  };

  const send = async (): Promise<void> => {
    const found = { ...refusalsForStep(1), ...refusalsForStep(2), ...refusalsForStep(3) };
    if (Object.keys(found).length > 0) {
      errors.set(found);
      const first = Object.keys(found)[0];
      if (first) focusFieldError(formId, first);
      return;
    }
    setBusy(true);
    errors.clear();
    startPending(pending.sendEnquiry);
    try {
      const result = await request<{ enquiry: { reference: string } }>('/api/enquiries', {
        body: {
          name: form.name,
          company: form.company,
          email: form.email,
          phone: form.phone,
          sector: form.sector,
          region: form.region,
          sites: Number(form.sites),
          openingMonth: form.openingMonth,
          message: form.message,
        },
      });
      clearEnquiryDraft();
      setReference(result.enquiry.reference);
      say(success.enquirySent(form.name, result.enquiry.reference));
      focusWhenReady('[data-focus="enquiry-success"]');
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'validation') {
        errors.set(caught.errors);
        const stepOfError = STEP_FIELDS.findIndex((fields) =>
          fields.some((field) => field in caught.errors),
        );
        if (stepOfError >= 0 && stepOfError + 1 !== step) goToStep(stepOfError + 1);
        const first = Object.keys(caught.errors)[0];
        if (first) focusFieldError(formId, first);
      } else if (caught instanceof ApiError && caught.code === 'rate_limited') {
        problem(
          refusal.enquiryRateLimit(
            form.email,
            caught.extra<number>('retryAfterSeconds') ?? 1,
          ),
        );
      } else {
        problem(refusal.networkFailure);
      }
    } finally {
      setBusy(false);
    }
  };

  if (reference !== null) {
    return (
      <PublicShell title="Start a project · Marrow Hall Interiors">
        <section className="section" data-tone="light">
          <div className="section-inner form-card">
            <h1 data-focus="enquiry-success" tabIndex={-1}>
              {success.enquirySent(form.name, reference)}
            </h1>
            <p>
              We read every enquiry ourselves. Quote your reference if you write to us before we
              reply.
            </p>
          </div>
        </section>
      </PublicShell>
    );
  }

  return (
    <PublicShell title="Start a project · Marrow Hall Interiors">
      <section className="section" data-tone="light">
        <div className="section-inner form-card">
          <form
            noValidate
            aria-label="Start a project"
            onSubmit={(event) => {
              event.preventDefault();
              if (step === 3) void send();
              else onNext();
            }}
          >
            <h1>{STEP_HEADINGS[step - 1]}</h1>
            <ErrorSummary formId={formId} errors={errors.errors} />

            {step === 1 ? (
              <>
                <Field formId={formId} path="name" label="Your name" errors={errors.errors}>
                  {(attributes) => (
                    <input
                      {...attributes}
                      type="text"
                      autoComplete="name"
                      value={form.name}
                      onChange={(event) => update({ name: event.target.value })}
                    />
                  )}
                </Field>
                <Field formId={formId} path="company" label="Company" errors={errors.errors}>
                  {(attributes) => (
                    <input
                      {...attributes}
                      type="text"
                      autoComplete="organization"
                      value={form.company}
                      onChange={(event) => update({ company: event.target.value })}
                    />
                  )}
                </Field>
                <Field formId={formId} path="email" label="Email" errors={errors.errors}>
                  {(attributes) => (
                    <input
                      {...attributes}
                      type="email"
                      autoComplete="email"
                      value={form.email}
                      onChange={(event) => update({ email: event.target.value })}
                    />
                  )}
                </Field>
                <Field
                  formId={formId}
                  path="phone"
                  label="Phone (optional)"
                  errors={errors.errors}
                >
                  {(attributes) => (
                    <input
                      {...attributes}
                      type="tel"
                      autoComplete="tel"
                      value={form.phone}
                      onChange={(event) => update({ phone: event.target.value })}
                    />
                  )}
                </Field>
              </>
            ) : null}

            {step === 2 ? (
              <>
                <Field formId={formId} path="sector" label="Sector" errors={errors.errors}>
                  {(attributes) => (
                    <select
                      {...attributes}
                      value={form.sector}
                      onChange={(event) => update({ sector: event.target.value as Sector })}
                    >
                      {SECTORS.map((key) => (
                        <option key={key} value={key}>
                          {SECTOR_LABELS[key]}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
                <Field formId={formId} path="region" label="Region" errors={errors.errors}>
                  {(attributes) => (
                    <select
                      {...attributes}
                      value={form.region}
                      onChange={(event) => update({ region: event.target.value as Region })}
                    >
                      {(['HK', 'SG', 'MO'] as Region[]).map((key) => (
                        <option key={key} value={key}>
                          {REGION_LABELS[key]}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
                <Field
                  formId={formId}
                  path="sites"
                  label="Number of sites"
                  errors={errors.errors}
                >
                  {(attributes) => (
                    <input
                      {...attributes}
                      type="number"
                      min={1}
                      max={200}
                      step={1}
                      value={form.sites}
                      onChange={(event) => update({ sites: event.target.value })}
                    />
                  )}
                </Field>
                <Field
                  formId={formId}
                  path="openingMonth"
                  label="Target opening month"
                  errors={errors.errors}
                  hint="Written as YYYY-MM, for example 2027-03."
                >
                  {(attributes) => (
                    <input
                      {...attributes}
                      type="text"
                      inputMode="numeric"
                      placeholder="2027-03"
                      value={form.openingMonth}
                      onChange={(event) => update({ openingMonth: event.target.value })}
                    />
                  )}
                </Field>
              </>
            ) : null}

            {step === 3 ? (
              <Field
                formId={formId}
                path="message"
                label="Tell us about the rollout"
                errors={errors.errors}
              >
                {(attributes) => (
                  <textarea
                    {...attributes}
                    rows={7}
                    value={form.message}
                    onChange={(event) => update({ message: event.target.value })}
                  />
                )}
              </Field>
            ) : null}

            <div className="step-nav">
              {step > 1 ? (
                <button type="button" onClick={() => goToStep(step - 1)}>
                  Back
                </button>
              ) : null}
              {step < 3 ? (
                <button type="button" className="primary" onClick={onNext}>
                  Next
                </button>
              ) : (
                <PrimaryButton
                  label="Send enquiry"
                  busy={busy}
                  pendingLabel={pending.sendEnquiry}
                  onPress={() => void send()}
                />
              )}
            </div>
          </form>
        </div>
      </section>
    </PublicShell>
  );
}
