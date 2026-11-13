// The founder's studio: sign-in, dashboard (health, engagements, case studies, services, rates) and one engagement.
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { api, type CaseStudy, type Engagement, type Invoice, type Primitive, type Service } from "../api";
import { Dialog } from "../components/Dialog";
import { Field } from "../components/Forms";
import { SubjectView } from "../components/Scenes";
import { Shell } from "../components/Shell";
import { fileSize, intakeStatus, STATUS_WORDS } from "../words";
import { CURRENCIES, formatMoney, majorToMinor } from "../../shared/money";
import { longDate, MILESTONE_LABELS, utcTime } from "../../shared/format";
import { NotFound } from "./Public";

const HEALTH: [string, string][] = [
  ["postgres", "Postgres"],
  ["killbill", "Kill Bill"],
  ["minio", "File storage"],
  ["mailpit", "Email"],
  ["pocketbase", "Studio content"],
  ["rabbitmq", "Measuring queue"],
  ["gotenberg", "Documents"],
  ["meilisearch", "Search"],
  ["ntfy", "Studio alerts"],
];

/** Shows the password form until the founder has a session. */
function useFounder(): { ready: boolean | null; signIn: (password: string) => Promise<string> } {
  const [ready, setReady] = useState<boolean | null>(null);
  useEffect(() => {
    void api("GET", "/api/studio/health").then((reply) => setReady(reply.ok));
  }, []);
  const signIn = async (password: string): Promise<string> => {
    const reply = await api("POST", "/api/studio/session", { password });
    if (reply.ok) setReady(true);
    return reply.ok ? "" : reply.failure.message;
  };
  return { ready, signIn };
}

function StudioSignIn({ signIn }: { signIn: (password: string) => Promise<string> }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  return (
    <div class="wrap form-page">
      <h1>Studio</h1>
      <form
        aria-label="Studio sign in"
        noValidate
        onSubmit={async (event) => {
          event.preventDefault();
          setError((await signIn(password)) || undefined);
        }}
      >
        <Field id="studio-password" label="Studio password" type="password" value={password} onInput={setPassword} error={error} autocomplete="current-password" />
        <button type="submit" class="button primary">
          Sign in
        </button>
      </form>
    </div>
  );
}

function ServiceEditor({ service, onSaved }: { service: Service; onSaved: (s: Service) => void }) {
  const [title, setTitle] = useState(service.title);
  const [price, setPrice] = useState(String(service.list_price_pence));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  return (
    <form
      class="inline-form"
      aria-label={`Edit ${service.title}`}
      noValidate
      onSubmit={async (event) => {
        event.preventDefault();
        const reply = await api<Service>("PATCH", `/api/studio/services/${service.code}`, { title, list_price_pence: /^\d+$/.test(price) ? Number(price) : price });
        if (reply.ok) {
          setErrors({});
          setNote("Service saved.");
          onSaved(reply.data);
        } else {
          setNote(reply.failure.fields ? "" : reply.failure.message);
          setErrors(reply.failure.fields ?? {});
        }
      }}
    >
      <Field id={`svc-title-${service.code}`} label="Shot title" value={title} onInput={setTitle} error={errors.title} />
      <Field id={`svc-price-${service.code}`} label="Price per colourway (pence)" value={price} onInput={setPrice} error={errors.list_price_pence} inputMode="numeric" />
      <button type="submit" class="button">
        Save service
      </button>
      <span role="status">{note}</span>
    </form>
  );
}

function CaseStudyEditor({ study, onSaved }: { study: CaseStudy; onSaved: () => void }) {
  const [note, setNote] = useState("");
  const toggle = async (): Promise<void> => {
    const reply = await api<CaseStudy>("PATCH", `/api/studio/work/${study.slug}`, { published: !study.published });
    setNote(reply.ok ? (reply.data.published ? "Published." : "Moved to drafts.") : reply.failure.message);
    if (reply.ok) onSaved();
  };
  return (
    <li>
      <SubjectView study={study} kind="plain" class="tile-scene" />
      <strong>{study.title}</strong>
      <span class="muted">{study.client}</span>
      <span class="badge" data-kind={study.published ? "published" : "draft"}>
        {study.published ? "Published" : "Draft"}
      </span>
      <button type="button" class="button" onClick={() => void toggle()}>
        {study.published ? `Unpublish ${study.title}` : `Publish ${study.title}`}
      </button>
      <span role="status">{note}</span>
    </li>
  );
}

function NewCaseStudy({ onSaved }: { onSaved: () => void }) {
  const [form, setForm] = useState({ slug: "", title: "", client: "", summary: "", primitives: "box, cylinder", accent: "ember" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const set = (key: keyof typeof form) => (value: string) => setForm({ ...form, [key]: value });
  return (
    <form
      aria-label="New case study"
      noValidate
      onSubmit={async (event) => {
        event.preventDefault();
        const body = {
          slug: form.slug,
          title: form.title,
          client: form.client,
          summary: form.summary,
          scene: { primitives: form.primitives.split(",").map((p) => p.trim()).filter(Boolean) as Primitive[], accent: form.accent },
          published: false,
          sort: 100,
        };
        const reply = await api<CaseStudy>("POST", "/api/studio/work", body);
        setErrors(reply.ok ? {} : reply.failure.fields ?? {});
        setNote(reply.ok ? "Case study saved as a draft." : reply.failure.fields ? "" : reply.failure.message);
        if (reply.ok) onSaved();
      }}
    >
      <Field id="cs-slug" label="Slug" value={form.slug} onInput={set("slug")} error={errors.slug} />
      <Field id="cs-title" label="Title" value={form.title} onInput={set("title")} error={errors.title} />
      <Field id="cs-client" label="Client" value={form.client} onInput={set("client")} error={errors.client} />
      <Field id="cs-summary" label="Summary" value={form.summary} onInput={set("summary")} error={errors.summary} multiline />
      <Field id="cs-primitives" label="Primitives (box, cylinder, sphere, torus, capsule)" value={form.primitives} onInput={set("primitives")} error={errors.scene} />
      <Field id="cs-accent" label="Accent (ember, cobalt or violet)" value={form.accent} onInput={set("accent")} />
      <button type="submit" class="button">
        Save draft
      </button>
      <span role="status">{note}</span>
    </form>
  );
}

type Rate = { currency: string; rate: string; effective_at: string };

function Rates() {
  const [table, setTable] = useState<{ rates: Rate[]; scheduled: Rate[] } | null>(null);
  const [form, setForm] = useState({ currency: "EUR", rate: "", effective_at: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const load = useCallback(() => void api<{ rates: Rate[]; scheduled: Rate[] }>("GET", "/api/studio/fx-rates").then((r) => r.ok && setTable(r.data)), []);
  useEffect(load, [load]);
  const when = (iso: string): string => `${longDate(iso)}, ${utcTime(iso)} UTC`;
  return (
    <section aria-labelledby="rates-title">
      <h2 id="rates-title">Exchange rates</h2>
      <div class="table-scroll" tabIndex={0} role="region" aria-label="Exchange rates, scrollable">
        <table aria-label="Exchange rates">
          <thead>
            <tr>
              <th scope="col">Currency</th>
              <th scope="col" class="num">
                Rate
              </th>
              <th scope="col">Effective from</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {table?.rates.map((r) => (
              <tr key={`now-${r.currency}`}>
                <td>{r.currency}</td>
                <td class="num">{r.rate}</td>
                <td>{when(r.effective_at)}</td>
                <td>Current</td>
              </tr>
            ))}
            {table?.scheduled.map((r) => (
              <tr key={`later-${r.currency}-${r.effective_at}-${r.rate}`}>
                <td>{r.currency}</td>
                <td class="num">{r.rate}</td>
                <td>{when(r.effective_at)}</td>
                <td>Scheduled</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form
        class="inline-form"
        aria-label="Add a rate"
        noValidate
        style={{ marginTop: "24px" }}
        onSubmit={async (event) => {
          event.preventDefault();
          const body = { currency: form.currency, rate: form.rate, ...(form.effective_at ? { effective_at: new Date(form.effective_at).toISOString() } : {}) };
          const reply = await api<Rate>("POST", "/api/studio/fx-rates", body);
          setErrors(reply.ok ? {} : reply.failure.fields ?? {});
          setNote(reply.ok ? "Rate saved." : reply.failure.fields ? "" : reply.failure.message);
          if (reply.ok) load();
        }}
      >
        <div class="field">
          <label for="rate-currency">Currency</label>
          <select id="rate-currency" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.currentTarget.value })}>
            {(Object.keys(CURRENCIES) as (keyof typeof CURRENCIES)[]).filter((c) => c !== "GBP").map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <Field id="rate-value" label="Rate per £1" value={form.rate} onInput={(v) => setForm({ ...form, rate: v })} error={errors.rate} inputMode="decimal" />
        <Field id="rate-when" label="Effective from (optional)" type="datetime-local" value={form.effective_at} onInput={(v) => setForm({ ...form, effective_at: v })} error={errors.effective_at} />
        <button type="submit" class="button">
          Add rate
        </button>
        <span role="status">{note}</span>
      </form>
    </section>
  );
}

export function StudioPage() {
  const { ready, signIn } = useFounder();
  const [health, setHealth] = useState<Record<string, string> | null>(null);
  const [engagements, setEngagements] = useState<{ id: string; reference: string; title: string; state: string; brand_name: string }[]>([]);
  const [studies, setStudies] = useState<CaseStudy[] | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [settled, setSettled] = useState(0);
  const loadWork = useCallback(() => void api<{ case_studies: CaseStudy[] }>("GET", "/api/studio/work").then((r) => r.ok && setStudies(r.data.case_studies)), []);
  useEffect(() => {
    if (!ready) return;
    // The dashboard renders once, when its four first reads have settled (success or not), so nothing below shifts.
    const done = (): void => setSettled((n) => n + 1);
    void api<Record<string, string>>("GET", "/api/studio/health").then((r) => { if (r.ok) setHealth(r.data); done(); });
    void api<{ engagements: typeof engagements }>("GET", "/api/studio/engagements").then((r) => { if (r.ok) setEngagements(r.data.engagements); done(); });
    void api<{ services: Service[] }>("GET", "/api/content").then((r) => { if (r.ok) setServices(r.data.services); done(); });
    void api<{ case_studies: CaseStudy[] }>("GET", "/api/studio/work").then((r) => { if (r.ok) setStudies(r.data.case_studies); done(); });
  }, [ready]);
  return (
    <Shell>
      {ready === false && <StudioSignIn signIn={signIn} />}
      {ready && settled < 4 && <div class="wrap page" aria-busy="true" />}
      {ready && settled >= 4 && (
        <div class="wrap page">
          <h1>Studio</h1>
          <section aria-label="Service health">
            <h2>Service health</h2>
            <ul class="health">
              {HEALTH.map(([key, label]) => (
                <li key={key}>
                  <span>{label}</span>
                  <span data-state={health?.[key] ?? "unknown"}>{health ? (health[key] === "up" ? "Up" : "Down") : "Checking"}</span>
                </li>
              ))}
            </ul>
          </section>
          <h2>Engagements</h2>
          <div class="table-scroll" tabIndex={0} role="region" aria-label="Engagements, scrollable">
            <table aria-label="Engagements">
              <thead>
                <tr>
                  <th scope="col">Reference</th>
                  <th scope="col">Brand</th>
                  <th scope="col">Title</th>
                  <th scope="col">State</th>
                </tr>
              </thead>
              <tbody>
                {engagements.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <a href={`/studio/engagements/${e.id}`}>{e.reference}</a>
                    </td>
                    <td>{e.brand_name}</td>
                    <td>{e.title}</td>
                    <td>{e.state.replace(/_/g, " ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h2>Case studies</h2>
          {studies === null ? (
            <div class="skeleton" aria-hidden="true" />
          ) : (
            <ul class="studio-grid" aria-label="Studio case studies">
              {studies.map((study) => (
                <CaseStudyEditor key={study.slug} study={study} onSaved={loadWork} />
              ))}
            </ul>
          )}
          <h2>New case study</h2>
          <NewCaseStudy onSaved={loadWork} />
          <h2>Shot titles and prices</h2>
          {services.map((service) => (
            <ServiceEditor key={service.code} service={service} onSaved={(saved) => setServices(services.map((s) => (s.code === saved.code ? saved : s)))} />
          ))}
          <Rates />
        </div>
      )}
    </Shell>
  );
}

// ---------- one engagement ----------

export function StudioEngagementPage({ id }: { id: string }) {
  const { ready, signIn } = useFounder();
  const [engagement, setEngagement] = useState<Engagement | null>(null);
  const [missing, setMissing] = useState(false);
  const [note, setNote] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [refund, setRefund] = useState("");
  const [refundError, setRefundError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const cancelOpener = useRef<HTMLButtonElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const pendingStill = useRef<{ shot: string; milestone: string } | null>(null);

  const load = useCallback(async () => {
    const reply = await api<Engagement>("GET", `/api/studio/engagements/${id}`);
    if (reply.status === 404) setMissing(true);
    else if (reply.ok) setEngagement(reply.data);
  }, [id]);
  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  if (missing) return <NotFound />;
  const currency = engagement?.brand.currency ?? "GBP";
  const act = async (method: string, path: string, success: string): Promise<void> => {
    const reply = await api(method, path, {});
    setNote(reply.ok ? success : reply.failure.message);
    await load();
  };
  const uploadStill = async (file: File): Promise<void> => {
    const target = pendingStill.current;
    if (!target) return;
    const form = new FormData();
    form.append("shot_code", target.shot);
    form.append("milestone", target.milestone);
    form.append("file", file);
    const response = await fetch(`/api/studio/engagements/${id}/stills`, { method: "POST", body: form, credentials: "same-origin" }).catch(() => null);
    const body = response ? ((await response.json().catch(() => null)) as { message?: string } | null) : null;
    setNote(response?.ok ? "Still posted." : body?.message ?? "The connection dropped. Check it and try again.");
    await load();
  };
  const cancel = async (event: Event): Promise<void> => {
    event.preventDefault();
    let minor: number;
    try {
      minor = majorToMinor(refund, currency);
    } catch {
      setRefundError("Enter a refund between 1 and the amount paid.");
      return;
    }
    setBusy(true);
    const reply = await api<{ refunded_minor: number }>("POST", `/api/studio/engagements/${id}/cancel`, { refund_minor: minor });
    setBusy(false);
    if (reply.ok) {
      setCancelling(false);
      setNote(`Engagement cancelled. Refund of ${formatMoney(reply.data.refunded_minor, currency)} recorded.`);
      await load();
    } else if (reply.failure.fields?.refund_minor) setRefundError(reply.failure.fields.refund_minor);
    else {
      setCancelling(false);
      setNote(reply.failure.message);
    }
  };

  return (
    <Shell>
      {ready === false && <StudioSignIn signIn={signIn} />}
      {ready && engagement && (
        <div class="wrap page">
          <a href="/studio">Back to the studio</a>
          <span class="eyebrow" style={{ marginTop: "24px" }}>
            {engagement.reference} · {engagement.brand.name}
          </span>
          <h1>{engagement.title}</h1>
          <p class="meta-line">
            <span>State: {engagement.state.replace(/_/g, " ")}</span>
            <span>Quote total {formatMoney(engagement.quote.total_minor, currency)}</span>
            <span>{engagement.review_link ? `Review link live until ${longDate(engagement.review_link.expires_at)}, ${utcTime(engagement.review_link.expires_at)} UTC` : "No live review link"}</span>
          </p>
          <p role="status" class={note ? "notice" : ""}>
            {note}
          </p>
          <h2>Intake files</h2>
          <ul class="plain-list" aria-label="Intake files">
            {engagement.files.map((file) => (
              <li key={file.id}>
                <span>{file.name}</span>
                <span class="muted">{fileSize(file.size_bytes)}</span>
                <span class="status-word" data-status={file.status}>
                  {intakeStatus(file)}
                </span>
                <a href={`/api/studio/engagements/${engagement.id}/files/${file.id}/content`} download={file.name}>
                  Download {file.name}
                </a>
              </li>
            ))}
          </ul>
          <h2>Stills</h2>
          <input
            type="file"
            accept="image/png,image/jpeg"
            class="sr-only"
            tabindex={-1}
            aria-hidden="true"
            ref={fileInput}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) void uploadStill(file);
            }}
          />
          <ul class="plain-list">
            {(["look_dev", "final_delivery"] as const).flatMap((milestone) =>
              engagement.quote.lines.map((line) => {
                const posted = engagement.stills?.some((s) => s.shot_code === line.shot_code && s.milestone === milestone);
                return (
                  <li key={`${milestone}-${line.shot_code}`}>
                    <span>
                      {MILESTONE_LABELS[milestone]} · {line.title}
                    </span>
                    <span class="muted">{posted ? "Posted" : "Not posted"}</span>
                    <button
                      type="button"
                      class="button"
                      onClick={() => {
                        pendingStill.current = { shot: line.shot_code, milestone };
                        fileInput.current?.click();
                      }}
                    >
                      Upload {MILESTONE_LABELS[milestone]} still for {line.title}
                    </button>
                  </li>
                );
              }),
            )}
          </ul>
          <div class="review-actions" style={{ marginTop: "24px" }}>
            <button type="button" class="button primary" onClick={() => void act("POST", `/api/studio/engagements/${id}/send-for-review`, "Review link created. The reviewer will receive it by email.")}>
              Send for review
            </button>
            <button type="button" class="button" onClick={() => void act("DELETE", `/api/studio/engagements/${id}/review-link`, "Review link revoked.")}>
              Revoke review link
            </button>
          </div>
          <h2>Invoices</h2>
          <ul class="plain-list">
            {engagement.invoices.map((invoice: Invoice) => (
              <li key={invoice.id}>
                <strong>{MILESTONE_LABELS[invoice.milestone]}</strong>
                <span class="muted">{invoice.number ? `Invoice ${invoice.number}` : "Not issued"}</span>
                <span class="num">{formatMoney(invoice.amount_minor, currency)}</span>
                <span class="status-word" data-status={invoice.status}>
                  {STATUS_WORDS[invoice.status]}
                </span>
                {invoice.lines.length > 1 && <span class="muted">{invoice.lines.slice(1).map((l) => `${l.description}: ${formatMoney(l.amount_minor, currency)}`).join("; ")}</span>}
                {invoice.status === "draft" && (
                  <button type="button" class="button primary" onClick={() => void act("POST", `/api/studio/invoices/${invoice.id}/issue`, "Invoice issued.")}>
                    Issue invoice {MILESTONE_LABELS[invoice.milestone]}
                  </button>
                )}
              </li>
            ))}
          </ul>
          <h2>Ledger</h2>
          <ul class="plain-list">
            {engagement.ledger.map((entry) => (
              <li key={entry.id}>
                <span>{entry.kind.replace("_", " ")}</span>
                <span class="num">{formatMoney(entry.amount_minor, currency)}</span>
                <span class="muted">{longDate(entry.created_at)}</span>
              </li>
            ))}
          </ul>
          <h2>Cancel</h2>
          <button
            type="button"
            class="button"
            ref={cancelOpener}
            onClick={() => {
              setRefund("");
              setRefundError(undefined);
              setCancelling(true);
            }}
          >
            Cancel and refund
          </button>
        </div>
      )}
      {cancelling && (
        <Dialog
          title="Cancel and refund"
          onClose={() => {
            setCancelling(false);
            cancelOpener.current?.focus();
          }}
        >
          <form noValidate onSubmit={cancel}>
            <Field id="refund-amount" label="Refund amount" hint={`In ${currency}, up to the amount paid.`} value={refund} onInput={setRefund} error={refundError} inputMode="decimal" />
            <div class="actions">
              <button type="submit" class="button primary" aria-busy={busy ? "true" : "false"}>
                Confirm cancellation
              </button>
              <button
                type="button"
                class="button"
                onClick={() => {
                  setCancelling(false);
                  cancelOpener.current?.focus();
                }}
              >
                Keep the engagement
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </Shell>
  );
}
