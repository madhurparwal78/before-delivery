import { useEffect, useRef, useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { api, ApiFailure, failureText } from "../api.js";
import { AccountShell, BillingBanner, useBilling, useFacilitator } from "../account.js";
import { wallClock } from "../format.js";
import { Dialog, Link, navigate, useTitle } from "../ui.js";
import { STATUS_LABELS, isLive } from "../../shared/states.js";
import { TEMPLATES, type Template } from "../../shared/templates.js";
import type { FacilitatorWorkshop } from "../types.js";

/** The success line the room shows after it opens from "Create workshop". */
let createdFlash: string | null = null;
export function takeCreatedFlash(): string | null {
  const flash = createdFlash;
  createdFlash = null;
  return flash;
}

export interface PlanLimit {
  message: string;
  used: number;
  limit: number;
}

export function planLimitOf(e: unknown): PlanLimit | null {
  if (!(e instanceof ApiFailure) || e.code !== "plan_limit") return null;
  return { message: e.message, used: Number(e.extra.used), limit: Number(e.extra.limit) };
}

export function UpgradeDialog({ limit, onClose, returnTo }: { limit: PlanLimit; onClose: () => void; returnTo?: () => HTMLElement | null }) {
  return (
    <Dialog title="Upgrade your plan" onClose={onClose} {...(returnTo ? { returnTo } : {})}>
      <p>{limit.message}</p>
      <p className="mono">
        Used {limit.used} of {limit.limit}.
      </p>
      <div className="dialog-actions">
        <Link to="/billing" className="btn btn-primary">
          See plans
        </Link>
        <button type="button" className="btn btn-quiet" onClick={onClose}>
          Not now
        </button>
      </div>
    </Dialog>
  );
}

type Fields = Partial<Record<"title" | "template" | "scheduledStart" | "scheduledEnd" | "sponsorEmail" | "fee", string>>;

function NewWorkshopDialog({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ title: "", template: "" as Template | "", start: "", end: "", sponsor: "", fee: "" });
  const [fields, setFields] = useState<Fields>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [limit, setLimit] = useState<PlanLimit | null>(null);
  const createButton = useRef<HTMLButtonElement>(null);
  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const body = {
        title: form.title,
        template: form.template,
        scheduledStart: form.start,
        scheduledEnd: form.end,
        sponsorEmail: form.sponsor,
        ...(form.fee.trim() === "" ? {} : { fee: form.fee.trim() }),
      };
      const r = await api<{ workshop: FacilitatorWorkshop }>("POST", "/api/workshops", body);
      createdFlash = `Workshop created from the ${TEMPLATES[r.workshop.template].label} template`;
      navigate(`/w/${r.workshop.id}`);
    } catch (failure) {
      setBusy(false);
      const planLimit = planLimitOf(failure);
      if (planLimit) setLimit(planLimit);
      else if (failure instanceof ApiFailure && failure.code === "validation") setFields(failure.fields as Fields);
      else setError(failureText(failure, "You're offline — check your connection and try again."));
    }
  };

  const field = (id: keyof Fields, label: string, input: JSX.Element) => (
    <div className="field">
      <label htmlFor={`nw-${id}`}>{label}</label>
      {input}
      {fields[id] && (
        <p className="field-message" id={`nw-${id}-msg`}>
          {fields[id]}
        </p>
      )}
    </div>
  );
  const described = (id: keyof Fields) => (fields[id] ? { "aria-describedby": `nw-${id}-msg`, "aria-invalid": true } : {});

  return (
    <>
      <Dialog title="New workshop" onClose={onClose} wide>
        <form onSubmit={submit} noValidate className="form">
          {field("title", "Title", <input id="nw-title" data-autofocus value={form.title} onChange={(e) => set("title")(e.target.value)} {...described("title")} />)}
          <div className="field">
            <div role="radiogroup" aria-label="Template" className="template-choices" {...described("template")}>
              <span className="label" aria-hidden="true">
                Template
              </span>
              {(Object.keys(TEMPLATES) as Template[]).map((t) => (
                <label key={t} className="choice">
                  <input type="radio" name="template" checked={form.template === t} onChange={() => set("template")(t)} />
                  <span>
                    {TEMPLATES[t].label}
                    <span className="choice-meta">{TEMPLATES[t].frames.join(" · ")}</span>
                  </span>
                </label>
              ))}
            </div>
            {fields.template && (
              <p className="field-message" id="nw-template-msg">
                {fields.template}
              </p>
            )}
          </div>
          <div className="field-row">
            {field("scheduledStart", "Starts", <input id="nw-scheduledStart" type="datetime-local" value={form.start} onChange={(e) => set("start")(e.target.value)} {...described("scheduledStart")} />)}
            {field("scheduledEnd", "Ends", <input id="nw-scheduledEnd" type="datetime-local" value={form.end} onChange={(e) => set("end")(e.target.value)} {...described("scheduledEnd")} />)}
          </div>
          <div className="field-row">
            {field("sponsorEmail", "Sponsor email", <input id="nw-sponsorEmail" type="email" value={form.sponsor} onChange={(e) => set("sponsor")(e.target.value)} {...described("sponsorEmail")} />)}
            {field("fee", "Client fee (EUR)", <input id="nw-fee" inputMode="decimal" value={form.fee} onChange={(e) => set("fee")(e.target.value)} {...described("fee")} />)}
          </div>
          <div role="alert" className="form-alert">
            {error}
          </div>
          <div className="dialog-actions">
            <button ref={createButton} type="submit" className="btn btn-primary">
              {busy ? "Creating…" : "Create workshop"}
            </button>
            <button type="button" className="btn btn-quiet" onClick={onClose}>
              Cancel
            </button>
          </div>
        </form>
      </Dialog>
      {limit && <UpgradeDialog limit={limit} onClose={() => setLimit(null)} returnTo={() => createButton.current} />}
    </>
  );
}

function WorkshopRow({ w }: { w: FacilitatorWorkshop }) {
  return (
    <li className="ruled-row workshop-row">
      <Link to={`/w/${w.id}`} className="row-title">
        {w.title}
      </Link>
      <span className="row-meta">
        <span className={isLive(w.status) ? "status-label live" : "status-label"}>{STATUS_LABELS[w.status]}</span>
        <span className="mono">{wallClock(w.scheduledStart)}</span>
      </span>
    </li>
  );
}

export function Workshops() {
  useTitle("Your workshops");
  const me = useFacilitator();
  const [billing, setBilling] = useBilling();
  const [workshops, setWorkshops] = useState<FacilitatorWorkshop[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    api<{ workshops: FacilitatorWorkshop[] }>("GET", "/api/workshops").then(
      (r) => setWorkshops(r.workshops),
      () => setWorkshops([]),
    );
  }, []);

  const active = workshops?.filter((w) => w.status !== "archived") ?? [];
  const archived = workshops?.filter((w) => w.status === "archived") ?? [];
  return (
    <AccountShell>
      <main className="column">
        {me && <BillingBanner billing={billing} zone={me.timeZone} onBilling={setBilling} report={(kind, text) => setNotice({ kind, text })} />}
        <div role="alert" className="form-alert">
          {notice?.kind === "error" ? notice.text : ""}
        </div>
        <div role="status" className="sr-status">
          {notice?.kind === "ok" ? notice.text : ""}
        </div>
        <div className="page-head">
          <h1 className="display-sm">Your workshops</h1>
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            <Plus aria-hidden="true" size={20} strokeWidth={1.75} />
            New workshop
          </button>
        </div>
        <p className="page-links">
          <Link to="/billing">Plan and billing</Link>
          <Link to="/activity">Activity log</Link>
        </p>
        {workshops === null ? (
          <p className="muted">Loading your workshops…</p>
        ) : (
          <>
            <ul aria-label="Workshops" className="ruled-list">
              {active.map((w) => (
                <WorkshopRow key={w.id} w={w} />
              ))}
            </ul>
            {active.length === 0 && <p className="empty">No workshops yet. Start one from a template.</p>}
            <h2 className="h3 section-title">Archived</h2>
            <ul aria-label="Archived" className="ruled-list">
              {archived.map((w) => (
                <WorkshopRow key={w.id} w={w} />
              ))}
            </ul>
            {archived.length === 0 && <p className="empty">Nothing archived yet.</p>}
          </>
        )}
      </main>
      {creating && <NewWorkshopDialog onClose={() => setCreating(false)} />}
    </AccountShell>
  );
}
