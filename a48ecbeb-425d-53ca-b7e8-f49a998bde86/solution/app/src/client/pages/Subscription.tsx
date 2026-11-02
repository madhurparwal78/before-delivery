import { ArrowLeft, Ban, CalendarClock, CircleCheck, CircleX, Clock, CreditCard, Pause, Play, Repeat, SkipForward, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { FLAVOUR_NAMES, longDate, longDateTime } from "../../shared/format";
import { api, ApiFailure } from "../lib/api";
import { Link, navigate, useLocation } from "../lib/router";
import type { Cadence, Change, Subscription } from "../lib/types";
import "./account.css";

type View = "home" | "pause" | "swap" | "cancel" | "card";

const BILLING_DOWN = "Billing is unreachable, so changes are paused. Your subscription hasn't changed.";
const STORE_DOWN = "The shop can't update right now. Try again in a moment.";
const ALREADY_PENDING = "A change is already waiting for confirmation.";
const NOT_POSSIBLE = "That change isn't possible right now.";
const DECLINED = "Your card was declined. No money was taken.";

const CHANGE_COPY: Record<Change["status"], string> = {
  pending_provider: "Saved. Waiting for billing to confirm.",
  applied: "Billing confirmed your change.",
  rejected: "Billing didn't accept this change. Nothing was changed.",
};

const CARD_COPY = {
  updated: "Card updated.",
  recovered: "Card updated. Your renewal is paid and your boxes are back on.",
} as const;
type CardLanding = keyof typeof CARD_COPY;

const KIND_TEXT: Record<Change["kind"], string> = {
  pause: "Pause",
  resume: "Resume",
  skip: "Skip next box",
  swap: "Flavour swap",
  cancel: "Cancel at end of term",
};

/** The boxes of the published Kill Bill plans; a plan name is `ceibo-<box>-<rhythm>`. */
const BOXES = [
  { box: "guava-lime", label: `${FLAVOUR_NAMES["guava-lime"]} box` },
  { box: "yuzu-ginger", label: `${FLAVOUR_NAMES["yuzu-ginger"]} box` },
  { box: "passionfruit-basil", label: `${FLAVOUR_NAMES["passionfruit-basil"]} box` },
  { box: "discovery", label: "Discovery box" },
];

export const cadenceText = (cadence: Cadence): string => (cadence === "monthly" ? "Every month" : "Every two months");

/** The state text, from Kill Bill's confirmed state only. */
export function stateText(sub: Subscription): string {
  switch (sub.state) {
    case "active":
      if (sub.pause) return `Pause scheduled from ${longDate(sub.pause.from)}, resumes ${longDate(sub.pause.resumes_on)}`;
      return sub.skip ? "Next box skipped" : "Active";
    case "paused":
      return `Paused until ${longDate(sub.pause?.resumes_on ?? sub.next_renewal_date)}`;
    case "past_due":
      return "Payment overdue";
    case "cancel_pending":
      return `Ends on ${longDate(sub.billing_end_date ?? sub.next_renewal_date)}`;
    case "cancelled":
      return "Cancelled";
  }
}

function cutoffNote(sub: Subscription): string {
  const date = longDate(sub.changes_apply_to);
  return sub.changes_apply_to !== sub.next_renewal_date
    ? `Changes made now apply to the box after next, on ${date}.`
    : `Changes made now apply to your next box, on ${date}.`;
}

function dunningCopy(dunning: NonNullable<Subscription["dunning"]>): string {
  if (dunning.shipments_held && dunning.cancels_at) {
    return `Your deliveries are on hold because we couldn't take payment. Update your card before ${longDateTime(new Date(dunning.cancels_at))} to restart them.`;
  }
  return "Your renewal payment didn't go through. Update your card to keep your boxes coming.";
}

const signIn = () => navigate(`/sign-in?next=${window.location.pathname}`, true);

const isBillingDown = (error: unknown): boolean => error instanceof ApiFailure && error.code === "billing_unavailable";

/** The status copy for a refused change request or card update. */
function failureCopy(error: unknown): string {
  if (!(error instanceof ApiFailure)) return STORE_DOWN;
  if (error.status === 401) signIn();
  if (error.code === "change_pending") return ALREADY_PENDING;
  if (error.status === 409) return NOT_POSSIBLE;
  if (error.status === 402) return DECLINED;
  if (error.code === "billing_unavailable") return BILLING_DOWN;
  return error.status === 503 ? STORE_DOWN : error.message;
}

type Load =
  | { kind: "loading" }
  | { kind: "ready"; sub: Subscription }
  | { kind: "missing" }
  | { kind: "billing" }
  | { kind: "store" };

function useSubscription(id: string): { load: Load; reload: () => Promise<void> } {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const reload = useCallback(async () => {
    try {
      const { subscription } = await api<{ subscription: Subscription }>("GET", `/api/subscriptions/${encodeURIComponent(id)}`);
      setLoad({ kind: "ready", sub: subscription });
    } catch (error) {
      if (!(error instanceof ApiFailure)) setLoad({ kind: "store" });
      else if (error.status === 401) signIn();
      else if (error.status === 404 || error.status === 403) setLoad({ kind: "missing" });
      else setLoad(isBillingDown(error) ? { kind: "billing" } : { kind: "store" });
    }
  }, [id]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { load, reload };
}

async function requestChange(id: string, body: { kind: Change["kind"]; cycles?: number; plan?: string }): Promise<Change> {
  return (await api<{ change: Change }>("POST", `/api/subscriptions/${encodeURIComponent(id)}/changes`, body)).change;
}

function NotFound() {
  return (
    <div className="page page-narrow">
      <h1>We couldn't find that page.</h1>
      <p className="lede">
        <Link className="text-link" href="/account">
          Go to your account
        </Link>
      </p>
    </div>
  );
}

function ChangeBadge({ change }: { change: Change }) {
  if (change.status === "pending_provider") {
    return (
      <span className="badge badge-pending">
        <Clock aria-hidden="true" size={16} />
        Pending confirmation
      </span>
    );
  }
  if (change.status === "applied") {
    return (
      <span className="badge badge-applied">
        <CircleCheck aria-hidden="true" size={16} />
        Applied
      </span>
    );
  }
  return (
    <span className="badge badge-rejected">
      <CircleX aria-hidden="true" size={16} />
      Rejected
    </span>
  );
}

function StatusLine({ children }: { children: ReactNode }) {
  return (
    <p className="status-line sub-state" role="status" aria-label="Subscription status">
      {children}
    </p>
  );
}

/** A change page: back link, heading, and the subscription once it loads. */
function ChangePage({ id, title, load, children }: { id: string; title: string; load: Load; children: (sub: Subscription) => ReactNode }) {
  if (load.kind === "missing") return <NotFound />;
  return (
    <div className="page page-narrow">
      <Link className="text-link" href={`/account/subscriptions/${id}`}>
        <ArrowLeft aria-hidden="true" size={18} />
        Back to your auto-delivery
      </Link>
      <h1>{title}</h1>
      <div className="panel sub-form" aria-busy={load.kind === "loading"}>
        {load.kind === "ready" && children(load.sub)}
        {load.kind === "loading" && <div className="skeleton record-skeleton" />}
        {(load.kind === "billing" || load.kind === "store") && <StatusLine>{load.kind === "billing" ? BILLING_DOWN : STORE_DOWN}</StatusLine>}
      </div>
    </div>
  );
}

function landingOf(search: URLSearchParams): { change: string | null; card: CardLanding | null } {
  const card = search.get("card");
  return { change: search.get("change"), card: card === "updated" || card === "recovered" ? card : null };
}

function Home({ id, search }: { id: string; search: URLSearchParams }) {
  const { load, reload } = useSubscription(id);
  const [landing] = useState(() => landingOf(search));
  const [tracked, setTracked] = useState<Change | null>(null);
  const [watchId, setWatchId] = useState<string | null>(landing.change);
  const [message, setMessage] = useState(
    landing.card ? CARD_COPY[landing.card] : landing.change ? CHANGE_COPY.pending_provider : "",
  );
  const [billingDown, setBillingDown] = useState(false);
  const [busy, setBusy] = useState(false);
  const sub = load.kind === "ready" ? load.sub : null;

  // Follow the change this page submitted or landed with, or the one already pending.
  const pending = sub?.pending_change ?? null;
  const settled = pending !== null && tracked?.id === pending.id && tracked.status !== "pending_provider";
  const pollId = watchId ?? (pending && !settled ? pending.id : null);

  useEffect(() => {
    if (!pollId) return;
    let live = true;
    let timer = 0;
    const check = async () => {
      try {
        const { change } = await api<{ change: Change }>(
          "GET",
          `/api/subscriptions/${encodeURIComponent(id)}/changes/${encodeURIComponent(pollId)}`,
        );
        if (!live) return;
        setTracked(change);
        if (change.status !== "pending_provider") {
          setWatchId(null);
          setMessage(CHANGE_COPY[change.status]);
          void reload();
          return;
        }
      } catch {
        if (!live) return;
      }
      timer = window.setTimeout(() => void check(), 2000);
    };
    void check();
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [id, pollId, reload]);

  const act = async (kind: "skip" | "resume") => {
    setBusy(true);
    try {
      const change = await requestChange(id, { kind });
      setTracked(change);
      setWatchId(change.id);
      setMessage(CHANGE_COPY.pending_provider);
      setBillingDown(false);
    } catch (error) {
      setMessage(failureCopy(error));
      setBillingDown(isBillingDown(error));
      if (!isBillingDown(error)) void reload();
    } finally {
      setBusy(false);
    }
  };

  if (load.kind === "missing") return <NotFound />;

  const outage = billingDown || load.kind === "billing";
  const shownMessage = outage ? BILLING_DOWN : load.kind === "store" ? STORE_DOWN : message || (pollId ? CHANGE_COPY.pending_provider : "");
  const locked = busy || pollId !== null || pending !== null;
  const latest = tracked ?? pending ?? sub?.last_change ?? null;
  const ongoing = sub !== null && sub.state !== "cancelled" && sub.state !== "cancel_pending";
  const base = `/account/subscriptions/${id}`;

  const changeLink = (to: string, label: string, icon: ReactNode) =>
    locked ? (
      <span className="btn btn-secondary" aria-disabled="true">
        {icon}
        {label}
      </span>
    ) : (
      <Link className="btn btn-secondary" href={`${base}/${to}`}>
        {icon}
        {label}
      </Link>
    );

  return (
    <div className="page page-narrow">
      <Link className="text-link" href="/account">
        <ArrowLeft aria-hidden="true" size={18} />
        Your account
      </Link>
      <h1>Your auto-delivery</h1>
      <div className="panel" aria-busy={load.kind === "loading"}>
        {sub && !outage && sub.dunning && sub.dunning.step !== "cancelled" && (
          <div role="alert" className="banner">
            <TriangleAlert aria-hidden="true" size={20} />
            <span>{dunningCopy(sub.dunning)}</span>
          </div>
        )}
        {sub && !outage && (
          <div className="sub-head">
            <h2>{sub.plan_label}</h2>
          </div>
        )}
        <StatusLine>
          {sub && !outage && <span>{stateText(sub)}</span>}
          {shownMessage && <span>{shownMessage}</span>}
        </StatusLine>
        {load.kind === "loading" && <div className="skeleton record-skeleton" />}
        {sub && !outage && (
          <>
            {sub.state === "cancelled" && sub.dunning?.step === "cancelled" && (
              <p className="sub-ended">This subscription ended because payment couldn't be taken.</p>
            )}
            <dl className="sub-facts">
              <div>
                <dt>Delivery</dt>
                <dd>{cadenceText(sub.cadence)}</dd>
              </div>
              {ongoing && (
                <div>
                  <dt>Next renewal</dt>
                  <dd>{longDate(sub.next_renewal_date)}</dd>
                </div>
              )}
              <div>
                <dt>Card</dt>
                <dd>
                  {sub.card.brand} <span className="num">•••• {sub.card.last4}</span>
                </dd>
              </div>
            </dl>
            {ongoing && (
              <p className="cutoff-note">
                <CalendarClock aria-hidden="true" size={18} />
                <span>{cutoffNote(sub)}</span>
              </p>
            )}
            {latest && (
              <div className="sub-change">
                <span>
                  Latest change: {KIND_TEXT[latest.kind]}, from {longDate(latest.effective_date)}
                </span>
                <ChangeBadge change={latest} />
              </div>
            )}
            {sub.state !== "cancelled" && (
              <div className="sub-actions">
                {changeLink("pause", "Pause deliveries", <Pause aria-hidden="true" size={18} />)}
                {(sub.pause || sub.state === "paused") && (
                  <button type="button" className="btn btn-secondary" disabled={locked} onClick={() => void act("resume")}>
                    <Play aria-hidden="true" size={18} />
                    Resume deliveries
                  </button>
                )}
                <button type="button" className="btn btn-secondary" disabled={locked} onClick={() => void act("skip")}>
                  <SkipForward aria-hidden="true" size={18} />
                  Skip next box
                </button>
                {changeLink("swap", "Swap flavours", <Repeat aria-hidden="true" size={18} />)}
                {changeLink("card", "Update card", <CreditCard aria-hidden="true" size={18} />)}
                {changeLink("cancel", "Cancel subscription", <Ban aria-hidden="true" size={18} />)}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Shared by the pause, swap and cancel pages: submit, then land on the subscription page. */
function useChangeSubmit(id: string) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const submit = async (body: { kind: Change["kind"]; cycles?: number; plan?: string }) => {
    setBusy(true);
    setMessage("");
    setFields({});
    try {
      const change = await requestChange(id, body);
      navigate(`/account/subscriptions/${id}?change=${change.id}`);
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 422) setFields(error.body.fields ?? {});
      else setMessage(failureCopy(error));
      setBusy(false);
    }
  };
  return { busy, message, fields, submit };
}

function PendingNote({ sub, message }: { sub: Subscription; message: string }) {
  return <StatusLine>{message || (sub.pending_change ? ALREADY_PENDING : "")}</StatusLine>;
}

function PauseView({ id }: { id: string }) {
  const { load } = useSubscription(id);
  const { busy, message, fields, submit } = useChangeSubmit(id);
  const [cycles, setCycles] = useState(1);
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit({ kind: "pause", cycles });
  };
  return (
    <ChangePage id={id} title="Pause deliveries" load={load}>
      {(sub) => (
        <form onSubmit={onSubmit} noValidate>
          <p className="cutoff-note">
            <CalendarClock aria-hidden="true" size={18} />
            <span>{cutoffNote(sub)}</span>
          </p>
          <div role="radiogroup" aria-labelledby="pause-for" aria-describedby={fields.cycles ? "pause-error" : undefined}>
            <p id="pause-for" className="label">
              Pause for
            </p>
            {[1, 2, 3].map((n) => (
              <label key={n} className="radio-row">
                <input type="radio" name="cycles" value={n} checked={cycles === n} onChange={() => setCycles(n)} />
                {n === 1 ? "1 box" : `${n} boxes`}
              </label>
            ))}
          </div>
          {fields.cycles && (
            <p id="pause-error" className="field-error">
              {fields.cycles}
            </p>
          )}
          <PendingNote sub={sub} message={message} />
          <button type="submit" className="btn btn-primary" disabled={busy || sub.pending_change !== null}>
            <Pause aria-hidden="true" size={18} />
            Save pause
          </button>
        </form>
      )}
    </ChangePage>
  );
}

function SwapView({ id }: { id: string }) {
  const { load } = useSubscription(id);
  const { busy, message, fields, submit } = useChangeSubmit(id);
  const [plan, setPlan] = useState("");
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit({ kind: "swap", plan });
  };
  return (
    <ChangePage id={id} title="Swap flavours" load={load}>
      {(sub) => (
        <form onSubmit={onSubmit} noValidate>
          <p className="cutoff-note">
            <CalendarClock aria-hidden="true" size={18} />
            <span>{cutoffNote(sub)}</span>
          </p>
          <div
            role="radiogroup"
            aria-labelledby="swap-box"
            aria-invalid={fields.plan ? true : undefined}
            aria-describedby={fields.plan ? "swap-error" : undefined}
          >
            <p id="swap-box" className="label">
              Choose your box
            </p>
            {BOXES.map(({ box, label }) => {
              const name = `ceibo-${box}-${sub.cadence}`;
              const current = name === sub.plan;
              return (
                <label key={box} className="radio-row">
                  <input type="radio" name="plan" value={name} checked={plan === name} disabled={current} onChange={() => setPlan(name)} />
                  <span>{label}</span>
                  {current && <span className="current">Current box</span>}
                </label>
              );
            })}
          </div>
          {fields.plan && (
            <p id="swap-error" className="field-error">
              {fields.plan}
            </p>
          )}
          <PendingNote sub={sub} message={message} />
          <button type="submit" className="btn btn-primary" disabled={busy || sub.pending_change !== null}>
            <Repeat aria-hidden="true" size={18} />
            Save swap
          </button>
        </form>
      )}
    </ChangePage>
  );
}

function CancelView({ id }: { id: string }) {
  const { load } = useSubscription(id);
  const { busy, message, submit } = useChangeSubmit(id);
  return (
    <ChangePage id={id} title="Cancel subscription" load={load}>
      {(sub) => (
        <>
          <p>
            Your {sub.plan_label} keeps coming until the end of the term you've paid for. Billing ends on{" "}
            <strong>{longDate(sub.next_renewal_date)}</strong>, and nothing is charged after that.
          </p>
          <PendingNote sub={sub} message={message} />
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || sub.pending_change !== null}
            onClick={() => void submit({ kind: "cancel" })}
          >
            <Ban aria-hidden="true" size={18} />
            Cancel at end of term
          </button>
        </>
      )}
    </ChangePage>
  );
}

const CARD_FIELDS = [
  { key: "number", id: "card-number", label: "Card number", autoComplete: "cc-number" },
  { key: "expiry", id: "card-expiry", label: "Expiry (MM/YY)", autoComplete: "cc-exp" },
  { key: "cvc", id: "card-cvc", label: "Security code", autoComplete: "cc-csc" },
] as const;
type CardField = (typeof CARD_FIELDS)[number]["key"];

/** `MM/YY` as integers; anything else is sent as month 0 so the server names the field. */
function parseExpiry(text: string): { expiry_month: number; expiry_year: number } {
  const m = /^\s*(\d{1,2})\s*\/\s*(\d{2})\s*$/.exec(text);
  return m ? { expiry_month: Number(m[1]), expiry_year: 2000 + Number(m[2]) } : { expiry_month: 0, expiry_year: 0 };
}

function CardView({ id }: { id: string }) {
  const { load } = useSubscription(id);
  const [values, setValues] = useState<Record<CardField, string>>({ number: "", expiry: "", cvc: "" });
  const [fields, setFields] = useState<Partial<Record<CardField, string>>>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const summary = useRef<HTMLDivElement>(null);
  const invalid = CARD_FIELDS.filter((f) => fields[f.key]);

  useEffect(() => {
    if (invalid.length > 0) summary.current?.focus();
  }, [fields, invalid.length]);

  const save = async (wasPastDue: boolean) => {
    setBusy(true);
    setMessage("");
    setFields({});
    try {
      await api("PUT", `/api/subscriptions/${encodeURIComponent(id)}/card`, {
        number: values.number,
        ...parseExpiry(values.expiry),
        cvc: values.cvc,
      });
      navigate(`/account/subscriptions/${id}?card=${wasPastDue ? "recovered" : "updated"}`);
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 422) setFields(error.body.fields ?? {});
      else setMessage(failureCopy(error));
      setBusy(false);
    }
  };

  return (
    <ChangePage id={id} title="Update card" load={load}>
      {(sub) => (
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void save(sub.state === "past_due");
          }}
        >
          <p>
            Your boxes are charged to {sub.card.brand} <span className="num">•••• {sub.card.last4}</span>.
          </p>
          {invalid.length > 0 && (
            <div ref={summary} role="alert" aria-label="Fix these fields" className="error-summary" tabIndex={-1}>
              <h2>Fix these fields</h2>
              <ul>
                {invalid.map((f) => (
                  <li key={f.key}>
                    <a
                      href={`#${f.id}`}
                      onClick={(event) => {
                        event.preventDefault();
                        document.getElementById(f.id)?.focus();
                      }}
                    >
                      {fields[f.key]}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="card-fields">
            {CARD_FIELDS.map((f) => (
              <div key={f.key} className="field">
                <label htmlFor={f.id}>{f.label}</label>
                <input
                  id={f.id}
                  type="text"
                  inputMode="numeric"
                  autoComplete={f.autoComplete}
                  value={values[f.key]}
                  aria-invalid={fields[f.key] ? true : undefined}
                  aria-describedby={fields[f.key] ? `${f.id}-error` : undefined}
                  onChange={(event) => setValues((v) => ({ ...v, [f.key]: event.target.value }))}
                />
                {fields[f.key] && (
                  <p id={`${f.id}-error`} className="field-error">
                    {fields[f.key]}
                  </p>
                )}
              </div>
            ))}
          </div>
          <StatusLine>{message}</StatusLine>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            <CreditCard aria-hidden="true" size={18} />
            Save card
          </button>
        </form>
      )}
    </ChangePage>
  );
}

export function SubscriptionPage({ id, view }: { id: string; view: View }) {
  const { search } = useLocation();
  switch (view) {
    case "home":
      // A new landing (?change= or ?card=) starts the page afresh.
      return <Home key={search.toString()} id={id} search={search} />;
    case "pause":
      return <PauseView id={id} />;
    case "swap":
      return <SwapView id={id} />;
    case "cancel":
      return <CancelView id={id} />;
    case "card":
      return <CardView id={id} />;
  }
}
