// Case study, Start a project, Sign in, Account and the one not-found page.
import { useEffect, useRef, useState } from "preact/hooks";
import { api, toSignIn, type CaseStudy, type Currency } from "../api";
import { ErrorSummary, Field } from "../components/Forms";
import { SubjectView } from "../components/Scenes";
import { Shell } from "../components/Shell";
import { cachedContent } from "../content";
import { navigate } from "../router";

export function NotFound() {
  useEffect(() => {
    document.title = "We couldn't find that page — Gloamwork";
  }, []);
  return (
    <Shell>
      <div class="wrap not-found">
        <h1>We couldn't find that page</h1>
        <p>The link may have expired, been withdrawn, or never existed.</p>
        <p>
          <a href="/">Back to the studio</a>
        </p>
      </div>
    </Shell>
  );
}

export function CaseStudyPage({ slug }: { slug: string }) {
  const known = cachedContent()?.case_studies.find((s) => s.slug === slug) ?? null;
  const [study, setStudy] = useState<CaseStudy | null>(known);
  const [missing, setMissing] = useState(false);
  const [clay, setClay] = useState(false);
  useEffect(() => {
    void api<CaseStudy>("GET", `/api/work/${encodeURIComponent(slug)}`).then((reply) => {
      if (reply.ok) setStudy(reply.data);
      else if (reply.status === 404) setMissing(true);
    });
  }, [slug]);
  useEffect(() => {
    if (study) document.title = `${study.title} — Gloamwork`;
  }, [study]);
  if (missing) return <NotFound />;
  return (
    <Shell search>
      <article class="wrap case-page">
        {study ? (
          <div class="case-layout">
            <h1>{study.title}</h1>
            <SubjectView study={study} kind="detail" class="case-figure" label={`${study.title} in 3D`} clay={clay}>
              <figcaption>A procedural study of the product, turning slowly. Switch on Clay view to read its form.</figcaption>
            </SubjectView>
            <p class="case-summary">{study.summary}</p>
            <div class="case-meta">
              <p>Client: {study.client}</p>
              <button type="button" role="switch" class="switch" aria-checked={clay ? "true" : "false"} onClick={() => setClay(!clay)}>
                <span class="track" aria-hidden="true" />
                Clay view
              </button>
            </div>
          </div>
        ) : (
          <div class="skeleton" aria-hidden="true" />
        )}
      </article>
    </Shell>
  );
}

const START_FIELDS: Record<string, string> = {
  brand_name: "brand-name",
  contact_name: "contact-name",
  email: "email",
  title: "project-title",
  finance_email: "finance-email",
  reviewer_email: "reviewer-email",
  currency: "currency-EUR",
};

export function StartPage() {
  const [form, setForm] = useState({ brand_name: "", contact_name: "", email: "", title: "", finance_email: "", reviewer_email: "", currency: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form) => (value: string) => setForm({ ...form, [key]: value });
  const submit = async (event: Event): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setFailure("");
    const body = { ...form, finance_email: form.finance_email || undefined };
    const reply = await api<{ engagement: { id: string } }>("POST", "/api/projects/start", body);
    setBusy(false);
    if (reply.ok) {
      navigate(`/rig/${reply.data.engagement.id}`);
      return;
    }
    setErrors(reply.failure.fields ?? {});
    setFailure(reply.failure.fields ? "" : reply.failure.message);
  };
  return (
    <Shell>
      <div class="wrap form-page">
        <span class="eyebrow">05 Start a project</span>
        <h1>Start a project</h1>
        <p class="muted">Tell us who you are. Next you upload your product's GLB, check its scale and build your shot list.</p>
        <form aria-label="Start a project" noValidate onSubmit={submit}>
          <ErrorSummary errors={errors} fieldIds={START_FIELDS} />
          {failure && (
            <p class="notice" role="alert">
              {failure} {failure.includes("Sign in") && <a href="/sign-in">Sign in</a>}
            </p>
          )}
          <Field id="brand-name" label="Brand name" value={form.brand_name} onInput={set("brand_name")} error={errors.brand_name} autocomplete="organization" />
          <Field id="contact-name" label="Your name" value={form.contact_name} onInput={set("contact_name")} error={errors.contact_name} autocomplete="name" />
          <Field id="email" label="Email" type="email" value={form.email} onInput={set("email")} error={errors.email} autocomplete="email" />
          <Field id="project-title" label="Project title" value={form.title} onInput={set("title")} error={errors.title} />
          <Field id="finance-email" label="Finance contact email" type="email" hint="Leave empty to use your own email." value={form.finance_email} onInput={set("finance_email")} error={errors.finance_email} />
          <Field id="reviewer-email" label="Reviewer email" type="email" value={form.reviewer_email} onInput={set("reviewer_email")} error={errors.reviewer_email} />
          <fieldset class="field" data-invalid={errors.currency ? "true" : "false"}>
            <legend id="currency-legend">Account currency</legend>
            {errors.currency && <p class="field-error">{errors.currency}</p>}
            <div class="radio-row currency-row" role="radiogroup" aria-labelledby="currency-legend">
              {(["EUR", "GBP", "USD", "JPY"] as Currency[]).map((code) => (
                <label key={code}>
                  <input type="radio" name="currency" id={`currency-${code}`} value={code} checked={form.currency === code} onChange={() => set("currency")(code)} />
                  {code}
                </label>
              ))}
            </div>
          </fieldset>
          <button type="submit" class="button primary" aria-busy={busy ? "true" : "false"}>
            {busy ? "Starting" : "Start project"}
          </button>
        </form>
      </div>
    </Shell>
  );
}

export function SignInPage({ search }: { search: string }) {
  const next = new URLSearchParams(search).get("next") ?? undefined;
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sent, setSent] = useState("");
  const [sending, setSending] = useState(false);
  const [signing, setSigning] = useState(false);
  const codeField = useRef<HTMLDivElement>(null);
  const sendCode = async (event: Event): Promise<void> => {
    event.preventDefault();
    setSending(true);
    const reply = await api("POST", "/api/session/code", { email });
    setSending(false);
    if (reply.ok) {
      setErrors({});
      setSent("If that email belongs to a Gloamwork client, a sign-in code is on its way.");
      codeField.current?.querySelector("input")?.focus();
    } else {
      setSent("");
      setErrors(reply.failure.fields ?? { email: reply.failure.message });
    }
  };
  const signIn = async (event: Event): Promise<void> => {
    event.preventDefault();
    setSigning(true);
    const reply = await api<{ landing: string }>("POST", "/api/session", { email, code, next });
    setSigning(false);
    if (reply.ok) location.assign(reply.data.landing);
    else setErrors({ code: reply.failure.message });
  };
  return (
    <Shell>
      <div class="wrap form-page">
        <h1>Sign in</h1>
        <p class="muted">We email a six-digit code to your address. It works once.</p>
        <ErrorSummary errors={errors} fieldIds={{ email: "signin-email", code: "signin-code" }} />
        <form aria-label="Send a sign-in code" noValidate onSubmit={sendCode}>
          <Field id="signin-email" label="Email" type="email" value={email} onInput={setEmail} error={errors.email} autocomplete="email" />
          <button type="submit" class="button" aria-busy={sending ? "true" : "false"}>
            {sending ? "Sending" : "Send code"}
          </button>
          {sent && (
            <p class="notice" role="status">
              {sent}
            </p>
          )}
        </form>
        <form aria-label="Sign in with your code" noValidate onSubmit={signIn} style={{ marginTop: "48px" }}>
          <div ref={codeField}>
            <Field id="signin-code" label="Code" value={code} onInput={setCode} error={errors.code} inputMode="numeric" autocomplete="one-time-code" />
          </div>
          <button type="submit" class="button primary" aria-busy={signing ? "true" : "false"}>
            Sign in
          </button>
        </form>
      </div>
    </Shell>
  );
}

export function AccountPage() {
  const [list, setList] = useState<{ id: string; reference: string; title: string; state: string }[] | null>(null);
  useEffect(() => {
    void api<{ engagements: { id: string; reference: string; title: string; state: string }[] }>("GET", "/api/engagements").then((reply) => {
      if (reply.status === 401) toSignIn();
      else if (reply.ok) setList(reply.data.engagements);
    });
  }, []);
  return (
    <Shell banner={["billing", "storage"]}>
      <div class="wrap page">
        <h1>Your engagements</h1>
        {list === null ? (
          <div class="skeleton" aria-hidden="true" />
        ) : (
          <ul class="link-list">
            {list.map((e) => (
              <li key={e.id}>
                <a href={`/account/engagements/${e.id}`}>
                  <span>
                    {e.title} <span class="muted">{e.reference}</span>
                  </span>
                  <span class="muted">{e.state.replace(/_/g, " ")}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Shell>
  );
}
