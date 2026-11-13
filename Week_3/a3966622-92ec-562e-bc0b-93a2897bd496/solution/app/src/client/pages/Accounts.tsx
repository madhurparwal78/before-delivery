// The accounts clerk's screen: tariff revisions and their publish form, moves with charges, the
// moves export and invoices, each issued only once Kill Bill confirms it.
import { useCallback, useEffect, useState } from "react";
import { centsFromDollars, dollarsField } from "../../shared/numerals";
import type { Invoice, Move, TariffRevision } from "../../shared/types";
import { get, NO_REPLY, request, useKeyedControl } from "../api";
import { navigate } from "../router";
import { Shell } from "../ui/Chrome";
import { CHARGES, dateTimeOf, dollars, statusText } from "../ui/format";
import { countCopy, FormErrors, type FieldErrors } from "../ui/FormErrors";
import { LiveRegion, useLive, type Live } from "../ui/live";

const REREAD_MS = 30_000;
const MONEY_MESSAGE = "Use dollars with up to two decimals, for example 42.50";

interface BandRow {
  from: string;
  to: string;
  amount: string;
}

interface Draft {
  label: string;
  date: string;
  time: string;
  draftFoot: string;
  minimum: string;
  night: string;
  detention: string;
  allowance: string;
  cancellation: string;
  bands: BandRow[];
}

const FIELD_IDS: Record<string, string> = {
  label: "rev-label",
  effective_at: "rev-date",
  draft_foot_cents: "rev-draft-foot",
  minimum_cents: "rev-minimum",
  night_percent: "rev-night",
  detention_half_hour_cents: "rev-detention",
  detention_allowance_half_hours: "rev-allowance",
  cancellation_cents: "rev-cancellation",
  tonnage_bands: "rev-band-1-from",
};

const draftFrom = (r: TariffRevision): Draft => ({
  label: "",
  date: "",
  time: "",
  draftFoot: dollarsField(r.draft_foot_cents),
  minimum: dollarsField(r.minimum_cents),
  night: String(r.night_percent),
  detention: dollarsField(r.detention_half_hour_cents),
  allowance: String(r.detention_allowance_half_hours),
  cancellation: dollarsField(r.cancellation_cents),
  bands: r.tonnage_bands.map((b) => ({ from: String(b.from_gt), to: b.to_gt === null ? "" : String(b.to_gt), amount: dollarsField(b.cents) })),
});

const whole = (text: string): number | string => (/^\d+$/.test(text.trim()) ? Number(text) : text);

function IssueButton({ invoice, announcements, onDone }: { invoice: Invoice; announcements: Live; onDone: () => void }) {
  const control = useKeyedControl();
  const issue = async (): Promise<void> => {
    const key = control.begin({ id: invoice.id });
    if (key === null) return;
    announcements.say("Issuing invoice...");
    const outcome = await request<Invoice>(`/api/invoices/${encodeURIComponent(invoice.id)}/issue`, { body: {}, key });
    control.end(outcome);
    if (outcome.kind === "no-reply") announcements.say(NO_REPLY);
    else if (outcome.kind === "ok" && outcome.data.state === "issued") announcements.say(`Invoice ${outcome.data.number ?? ""} issued`);
    else announcements.say("Invoice pending provider confirmation");
    if (outcome.kind !== "no-reply") onDone();
  };
  return (
    <button type="button" className="primary small" onClick={() => void issue()}>
      Issue<span className="sr-only"> invoice {invoice.id}</span>
    </button>
  );
}

export function Accounts() {
  const [revisions, setRevisions] = useState<TariffRevision[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [moves, setMoves] = useState<Move[] | null>(null);
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  // The body renders once, after the first read: on a narrow screen the columns stack, and filling the
  // revisions column in later would push the moves column already on screen down (layout shift).
  const [ready, setReady] = useState(false);
  const announcements = useLive();

  const reread = useCallback(async () => {
    const [revs, listed, billed] = await Promise.all([
      get<{ revisions: TariffRevision[] }>("/api/tariff-revisions"),
      get<{ moves: Move[] }>("/api/moves"),
      get<{ invoices: Invoice[] }>("/api/invoices"),
    ]);
    if (revs.kind === "ok") {
      setRevisions(revs.data.revisions);
      const latest = revs.data.revisions[revs.data.revisions.length - 1];
      setDraft((d) => d ?? (latest ? draftFrom(latest) : null));
    }
    if (listed.kind === "ok") setMoves(listed.data.moves.filter((m) => m.lines.length > 0));
    if (billed.kind === "ok") setInvoices(billed.data.invoices);
    setReady(true);
  }, []);

  useEffect(() => {
    void reread();
    const timer = setInterval(() => void reread(), REREAD_MS);
    return () => clearInterval(timer);
  }, [reread]);

  const change = (changes: Partial<Draft>): void => setDraft((d) => (d ? { ...d, ...changes } : d));
  const setBand = (index: number, changes: Partial<BandRow>): void =>
    setDraft((d) => (d ? { ...d, bands: d.bands.map((b, i) => (i === index ? { ...b, ...changes } : b)) } : d));

  const publish = async (): Promise<void> => {
    if (!draft) return;
    const local: FieldErrors = {};
    const money = (field: string, text: string): number | null => {
      const cents = centsFromDollars(text);
      if (cents === null) local[field] = MONEY_MESSAGE;
      return cents;
    };
    const body = {
      label: draft.label,
      effective_at: `${draft.date}T${draft.time}`,
      draft_foot_cents: money("draft_foot_cents", draft.draftFoot),
      minimum_cents: money("minimum_cents", draft.minimum),
      night_percent: whole(draft.night),
      detention_half_hour_cents: money("detention_half_hour_cents", draft.detention),
      detention_allowance_half_hours: whole(draft.allowance),
      cancellation_cents: money("cancellation_cents", draft.cancellation),
      tonnage_bands: draft.bands.map((b) => ({ from_gt: whole(b.from), to_gt: b.to.trim() === "" ? null : whole(b.to), cents: money("tonnage_bands", b.amount) })),
    };
    if (Object.keys(local).length) {
      setErrors(local);
      announcements.say(countCopy(local));
      return;
    }
    announcements.say("Publishing revision...");
    const outcome = await request<TariffRevision>("/api/tariff-revisions", { body });
    if (outcome.kind === "no-reply") {
      announcements.say(NO_REPLY);
      return;
    }
    if (outcome.kind === "ok") {
      setErrors({});
      announcements.say(`Revision ${outcome.data.label} published, effective ${dateTimeOf(outcome.data.effective_at)} port time`);
      void reread();
      return;
    }
    const found = outcome.error.errors ?? { effective_at: outcome.error.message };
    setErrors(found);
    announcements.say(countCopy(found));
  };

  return (
    <Shell>
      <h1 className="page-title">Accounts</h1>
      {!ready ? (
        <p className="muted">Loading accounts…</p>
      ) : (
      <div className="columns">
        <section className="column" aria-labelledby="revisions-heading">
          <h2 id="revisions-heading">Tariff revisions</h2>
          {revisions === null ? (
            <p className="muted">Loading revisions…</p>
          ) : (
            <ul className="rows">
              {revisions.map((r) => (
                <li key={r.id} className="row revision-row">
                  <span className="label-literal">{r.label}</span>
                  <span className="num row-meta">effective {dateTimeOf(r.effective_at)}</span>
                  <span className="muted">{r.moves.length ? `Priced ${r.moves.join(", ")}` : "No moves priced yet"}</span>
                </li>
              ))}
            </ul>
          )}
          <h2>Publish a revision</h2>
          <FormErrors errors={errors} fieldIds={FIELD_IDS} />
          {draft ? (
            <form
              className="form-grid"
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                void publish();
              }}
            >
              <label className="field span-2">
                <span>Revision label</span>
                <input id="rev-label" type="text" value={draft.label} onChange={(e) => change({ label: e.target.value })} />
              </label>
              <label className="field">
                <span>Effective date</span>
                <input id="rev-date" type="text" className="num" placeholder="YYYY-MM-DD" value={draft.date} onChange={(e) => change({ date: e.target.value.trim() })} />
              </label>
              <label className="field">
                <span>Effective time</span>
                <input type="text" className="num" placeholder="HH:MM" value={draft.time} onChange={(e) => change({ time: e.target.value.trim() })} />
              </label>
              <label className="field">
                <span>Rate per draft foot</span>
                <input id="rev-draft-foot" type="number" step="0.01" className="num" value={draft.draftFoot} onChange={(e) => change({ draftFoot: e.target.value })} />
              </label>
              <label className="field">
                <span>Minimum charge</span>
                <input id="rev-minimum" type="number" step="0.01" className="num" value={draft.minimum} onChange={(e) => change({ minimum: e.target.value })} />
              </label>
              <label className="field">
                <span>Night surcharge percent</span>
                <input id="rev-night" type="number" step="1" className="num" value={draft.night} onChange={(e) => change({ night: e.target.value })} />
              </label>
              <label className="field">
                <span>Detention per half hour</span>
                <input id="rev-detention" type="number" step="0.01" className="num" value={draft.detention} onChange={(e) => change({ detention: e.target.value })} />
              </label>
              <label className="field">
                <span>Detention allowance half hours</span>
                <input id="rev-allowance" type="number" step="1" className="num" value={draft.allowance} onChange={(e) => change({ allowance: e.target.value })} />
              </label>
              <label className="field">
                <span>Cancellation charge</span>
                <input id="rev-cancellation" type="number" step="0.01" className="num" value={draft.cancellation} onChange={(e) => change({ cancellation: e.target.value })} />
              </label>
              <fieldset className="span-2 bands">
                <legend>Tonnage bands</legend>
                {draft.bands.map((b, i) => (
                  <div key={i} className="band-row">
                    <label className="field">
                      <span>Tonnage band {i + 1} from GT</span>
                      <input id={`rev-band-${i + 1}-from`} type="number" step="1" className="num" value={b.from} onChange={(e) => setBand(i, { from: e.target.value })} />
                    </label>
                    <label className="field">
                      <span>Tonnage band {i + 1} to GT</span>
                      <input type="number" step="1" className="num" value={b.to} onChange={(e) => setBand(i, { to: e.target.value })} />
                    </label>
                    <label className="field">
                      <span>Tonnage band {i + 1} amount</span>
                      <input type="number" step="0.01" className="num" value={b.amount} onChange={(e) => setBand(i, { amount: e.target.value })} />
                    </label>
                    <button type="button" className="ghost small" onClick={() => change({ bands: draft.bands.filter((_, j) => j !== i) })}>
                      Remove tonnage band {i + 1}
                    </button>
                  </div>
                ))}
                <button type="button" className="ghost" onClick={() => change({ bands: [...draft.bands, { from: "", to: "", amount: "" }] })}>
                  Add tonnage band
                </button>
              </fieldset>
              <div className="span-2 actions">
                <button type="submit" className="primary">
                  Publish revision
                </button>
              </div>
            </form>
          ) : (
            <p className="muted">Loading the latest revision…</p>
          )}
        </section>
        <section className="column" aria-labelledby="charges-heading">
          <div className="pane-head">
            <h2 id="charges-heading">Moves with charges</h2>
            <a className="link-button" href="/api/exports/moves.csv" download="moves.csv">
              Export moves
            </a>
          </div>
          {moves === null ? (
            <p className="muted">Loading moves…</p>
          ) : (
            <ul className="rows">
              {moves.map((m) => (
                <li key={m.ref} className="row">
                  <a href={`/moves/${encodeURIComponent(m.ref)}`} onClick={(e) => { e.preventDefault(); navigate(`/moves/${encodeURIComponent(m.ref)}`); }} className="ref">
                    {m.ref}
                  </a>
                  <span>{m.vessel.name}</span>
                  <span className="status-chip" data-status={m.status}>
                    {statusText(m)}
                  </span>
                  <span className="muted">{CHARGES[m.billing.state]}</span>
                  <span className="num row-meta">{dollars(m.priced_by.total_cents)}</span>
                </li>
              ))}
            </ul>
          )}
          <h2>Invoices</h2>
          <LiveRegion name="Billing announcements" live={announcements} />
          {invoices === null ? (
            <p className="muted">Loading invoices…</p>
          ) : (
            <ul className="rows">
              {invoices.map((i) => (
                <li key={i.id} className="row invoice-row">
                  <a href={`/invoices/${encodeURIComponent(i.id)}`} onClick={(e) => { e.preventDefault(); navigate(`/invoices/${encodeURIComponent(i.id)}`); }}>
                    {i.id}
                  </a>
                  <span>{i.move_ref}</span>
                  <span className="status-chip">{i.state === "issued" ? "Issued" : "Pending"}</span>
                  {i.state === "issued" ? (
                    <>
                      <span className="num row-meta">No. {i.number}</span>
                      <span className="num row-meta">Balance {i.balance_cents === null ? "-" : dollars(i.balance_cents)}</span>
                    </>
                  ) : (
                    <span className="row-meta">
                      {i.charge_state === "posted" ? "Charges posted, not issued" : "Charges pending"} · <span className="num">{dollars(i.total_cents)}</span>
                    </span>
                  )}
                  {i.state === "pending" ? <IssueButton invoice={i} announcements={announcements} onDone={() => void reread()} /> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      )}
    </Shell>
  );
}
