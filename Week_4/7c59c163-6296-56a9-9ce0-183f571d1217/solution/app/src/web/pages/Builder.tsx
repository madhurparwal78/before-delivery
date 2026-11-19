import { useEffect, useRef, useState, type FormEvent } from "react";
import { money, PLAN_LABEL, PLAN_RATE, PLANS, type Plan } from "../../shared/rules";
import { api, ApiError, type Billing } from "../api";
import { Dialog } from "../components/Dialog";
import { Icon } from "../components/Icon";
import { Shell } from "../components/Shell";
import { Banner, Empty, Skeleton, Status, TableScroll } from "../components/ui";
import { COPY } from "../copy";
import { formatInZone, longDate } from "../format";
import { useMe } from "../session";

const STATE_TEXT = { active: "Active", payment_failed: "Payment failed", downgraded: "Downgraded" } as const;

interface ApiKey {
  id: string;
  name: string;
  created_at: string;
  revoked_at: string | null;
}

interface Webhooks {
  endpoint: { url: string; svix_endpoint_id: string; signing_secret: string } | null;
  delivery: "ok" | "delayed";
  attempts: { message_id: string; event_type: string; event_id: string | null; status: string; response_status: number; timestamp: string }[];
}

function PlanSection() {
  const [billing, setBilling] = useState<Billing | null>(null);
  const [choice, setChoice] = useState<Plan>("sandbox");
  const [status, setStatus] = useState("");
  const [down, setDown] = useState(false);
  const load = () =>
    api<Billing>("/api/billing").then((b) => {
      setBilling(b);
      setDown(b.provider === "unavailable");
    });
  useEffect(() => {
    void load().then(() => undefined);
  }, []);
  useEffect(() => {
    if (billing) setChoice(billing.pending_plan ?? billing.plan);
  }, [billing?.plan, billing?.pending_plan]);
  useEffect(() => {
    if (!billing || billing.state === "active") return;
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [billing?.state]);

  const change = async () => {
    setStatus(COPY.billing.updating);
    try {
      const next = await api<Billing>("/api/billing/plan", { body: { plan: choice } });
      setBilling(next);
      setDown(false);
      setStatus(next.pending_plan === choice && next.pending_effective_date ? COPY.billing.changesOn(choice, longDate(next.pending_effective_date)) : COPY.billing.updated(next.plan));
    } catch (error) {
      if (error instanceof ApiError && error.status === 503) {
        setDown(true);
        setStatus(COPY.billing.unavailable);
      } else if (error instanceof ApiError && error.code === "plan_locked") setStatus(COPY.billing.locked);
      else if (error instanceof ApiError && error.code === "already_on_plan" && billing) setStatus(COPY.billing.updated(billing.plan));
      else setStatus(COPY.billing.unavailable);
    }
  };

  const pay = async () => {
    setStatus(COPY.billing.paying);
    try {
      setBilling(await api<Billing>("/api/billing/pay", { method: "POST" }));
      setDown(false);
      setStatus(COPY.billing.paid);
    } catch (error) {
      if (error instanceof ApiError && error.status === 503) {
        setDown(true);
        setStatus(COPY.billing.unavailable);
      } else {
        setStatus("");
        void load();
      }
    }
  };

  return (
    <section className="olive-block plan" aria-label="Plan">
      <div className="plan-head">
        <h2 id="plan-title">Plan</h2>
        {billing && <span className={`state-tag state-${billing.state}`}>{billing.state !== "active" && <Icon name="alert" size={18} />}{STATE_TEXT[billing.state]}</span>}
      </div>
      <div className="plan-region">
        {down && <Banner>{COPY.billing.unavailable}</Banner>}
        {billing?.state === "payment_failed" && <Banner>{COPY.billing.failedBanner}</Banner>}
        {billing?.state === "downgraded" && <Banner>{COPY.billing.downgradedBanner}</Banner>}
        {billing === null ? (
          <Skeleton />
        ) : (
          <>
            <p className="plan-line">
              {PLAN_LABEL[billing.plan]} plan · keys at {billing.rate_per_second} requests per second
              {billing.pending_plan && billing.pending_effective_date ? ` · changes to ${PLAN_LABEL[billing.pending_plan]} on ${longDate(billing.pending_effective_date)}` : ""}
            </p>
            <div className="card plan-card">
              <div role="radiogroup" aria-label="Builder plan" className="plan-options">
                {PLANS.map((plan) => (
                  <label key={plan} className={`plan-option${choice === plan ? " is-checked" : ""}`}>
                    <input type="radio" name="builder-plan" value={plan} aria-label={PLAN_LABEL[plan]} checked={choice === plan} onChange={() => setChoice(plan)} />
                    <span className="plan-name">{PLAN_LABEL[plan]}</span>
                    <span className="muted small">{PLAN_RATE[plan]} req/s · {plan === "sandbox" ? "free" : plan === "builder" ? "$49.00 a month" : "$249.00 a month"}</span>
                  </label>
                ))}
              </div>
              <div className="actions">
                <button type="button" className="pill" onClick={() => void change()}>Change plan</button>
                {billing.state !== "active" && (
                  <button type="button" className="pill" onClick={() => void pay()}>Pay outstanding balance</button>
                )}
              </div>
              <Status label="Billing status" message={status} />
            </div>
            <div className="card">
              <h3 className="card-title" id="invoices-title">Invoices</h3>
              <TableScroll labelledBy="invoices-title">
                <table className="table" aria-labelledby="invoices-title">
                  <thead>
                    <tr><th scope="col">Invoice</th><th scope="col">Date</th><th scope="col">Items</th><th scope="col">Amount</th><th scope="col">Balance</th></tr>
                  </thead>
                  <tbody>
                    {billing.invoices.map((invoice) => (
                      <tr key={invoice.id}>
                        <td>#{invoice.number}</td>
                        <td>{longDate(invoice.invoice_date)}</td>
                        <td>{invoice.items.map((item) => `${item.description} ${money(item.amount_cents)}`).join("; ")}</td>
                        <td className="numeric">{money(invoice.amount_cents)}</td>
                        <td className="numeric">{money(invoice.balance_cents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
              {billing.invoices.length === 0 && <p className="muted">No invoices yet — Sandbox is free.</p>}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function KeysSection() {
  const [keys, setKeys] = useState<ApiKey[] | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const load = () => api<{ keys: ApiKey[] }>("/api/keys").then((r) => setKeys(r.keys)).catch(() => setKeys([]));
  useEffect(() => {
    void load();
  }, []);
  const create = async (event: FormEvent) => {
    event.preventDefault();
    setMessage(COPY.key.creating);
    try {
      const created = await api<{ secret: string }>("/api/keys", { body: { name } });
      setSecret(created.secret);
      setMessage(COPY.key.shownOnce);
      void load();
    } catch {
      setMessage(COPY.key.name);
    }
  };
  const close = () => {
    setOpen(false);
    setSecret(null);
    setName("");
    setMessage("");
    setCopied(false);
  };
  const revoke = async (key: ApiKey) => {
    await api(`/api/keys/${key.id}`, { method: "DELETE" });
    void load();
  };
  return (
    <section className="card keys" aria-labelledby="keys-title">
      <div className="card-head">
        <h2 className="card-title" id="keys-title">API keys</h2>
        <button type="button" className="pill" onClick={() => setOpen(true)}>Create API key</button>
      </div>
      {keys === null ? (
        <Skeleton />
      ) : keys.length === 0 ? (
        <Empty text="No keys yet — a key trades as you, at your plan's rate." sticker="cube" />
      ) : (
        <TableScroll label="API keys">
          <table className="table" aria-label="API keys">
            <thead>
              <tr><th scope="col">Name</th><th scope="col">Created</th><th scope="col">State</th><th scope="col"><span className="visually-hidden">Action</span></th></tr>
            </thead>
            <tbody>
              {keys.map((key) => (
                <tr key={key.id}>
                  <td>{key.name}</td>
                  <td>{new Date(key.created_at).toISOString().slice(0, 10)}</td>
                  <td>{key.revoked_at ? `Revoked ${key.revoked_at.slice(0, 10)}` : "Active"}</td>
                  <td>{!key.revoked_at && <button type="button" className="pill pill-small" aria-label={`Revoke ${key.name}`} onClick={() => void revoke(key)}>Revoke</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
      <Dialog title="New API key" open={open} onClose={close} initialFocus={nameInput}>
        {secret ? (
          <div className="secret">
            <code className="secret-value">{secret}</code>
            <p>{message}</p>
            <div className="dialog-actions">
              <button
                type="button"
                className="pill"
                onClick={() => {
                  void navigator.clipboard.writeText(secret).then(() => setCopied(true));
                }}
              >
                <Icon name={copied ? "check" : "copy"} /> {copied ? "Copied" : "Copy key"}
              </button>
              <button type="button" className="pill pill-quiet" onClick={close}>Done</button>
            </div>
          </div>
        ) : (
          <form className="form" onSubmit={(e) => void create(e)}>
            <div className="field-row">
              <label htmlFor="key-name">Key name</label>
              <input ref={nameInput} id="key-name" type="text" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <p className="field-error" role="status" aria-live="polite">{message}</p>
            <div className="dialog-actions">
              <button type="submit" className="pill">Create key</button>
            </div>
          </form>
        )}
      </Dialog>
    </section>
  );
}

function WebhooksSection() {
  const me = useMe();
  const [hooks, setHooks] = useState<Webhooks | null>(null);
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState("");
  const [down, setDown] = useState(false);
  const load = () =>
    api<Webhooks>("/api/webhooks").then((h) => {
      setHooks(h);
      setDown(h.delivery === "delayed");
      if (h.endpoint) setUrl((current) => current || (h.endpoint?.url ?? ""));
    });
  useEffect(() => {
    void load().catch(() => undefined);
  }, []);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    const valid = /^https?:\/\/\S+$/i.test(url.trim());
    if (!valid) {
      setStatus(COPY.webhook.url);
      return;
    }
    setStatus(COPY.webhook.saving);
    try {
      await api("/api/webhooks/endpoint", { method: "PUT", body: { url: url.trim() } });
      setStatus(COPY.webhook.saved);
      setDown(false);
      void load();
    } catch (error) {
      if (error instanceof ApiError && error.status === 503) {
        setDown(true);
        setStatus("");
      } else setStatus(COPY.webhook.url);
    }
  };
  return (
    <section className="card webhooks" aria-labelledby="webhooks-title">
      <h2 className="card-title" id="webhooks-title">Webhooks</h2>
      {down && <Banner>{COPY.webhook.delayed}</Banner>}
      <form className="form inline-form" onSubmit={(e) => void save(e)} noValidate>
        <div className="field-row grow">
          <label htmlFor="endpoint-url">Endpoint URL</label>
          <input id="endpoint-url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://bot.example/hooks" />
        </div>
        <button type="submit" className="pill">Save endpoint</button>
      </form>
      <Status label="Webhook status" message={status} />
      {hooks?.endpoint && <p className="muted small">Signed with Svix. Signing secret: <code>{hooks.endpoint.signing_secret}</code></p>}
      <TableScroll label="Delivery attempts">
        <table className="table" aria-label="Delivery attempts">
          <thead>
            <tr><th scope="col">Event</th><th scope="col">Event id</th><th scope="col">Status</th><th scope="col">Response</th><th scope="col">When</th></tr>
          </thead>
          <tbody>
            {(hooks?.attempts ?? []).map((attempt) => (
              <tr key={`${attempt.message_id}-${attempt.timestamp}`}>
                <td>{attempt.event_type}</td>
                <td className="wrap">{attempt.event_id}</td>
                <td>{attempt.status === "succeeded" ? "Succeeded" : attempt.status === "failed" ? "Failed" : "Pending"}</td>
                <td className="numeric">{attempt.response_status}</td>
                <td>{me.venue ? formatInZone(attempt.timestamp, me.venue.time_zone) : attempt.timestamp}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
      {(hooks?.attempts.length ?? 0) === 0 && <p className="muted">No delivery attempts yet.</p>}
    </section>
  );
}

export function BuilderPage() {
  return (
    <Shell field="olive">
      <div className="page-head">
        <h1>Builder</h1>
        <p className="stone-soft">Plans, API keys and signed webhooks for your bots.</p>
      </div>
      <div className="builder-grid">
        <PlanSection />
        <KeysSection />
        <WebhooksSection />
      </div>
    </Shell>
  );
}
