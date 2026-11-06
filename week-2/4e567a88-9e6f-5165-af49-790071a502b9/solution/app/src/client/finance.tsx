// The Finance screen: top-ups through Kill Bill, the ledger with its CSV, and the rate schedule.

import { useState } from "preact/hooks";
import { formatRate, formatWholeCredits, parseRateInput } from "../shared/money";
import { ApiError, get, query, refreshAll, request, type Movement, type Rate, type Topup } from "./api";
import { capitalised, credits, getOrgZone, personName, usePoll, when } from "./hooks";
import { CreditMeter } from "./meter";
import { JobDialog } from "./jobs";
import { teamNameOf, useSession } from "./session";
import { Alert, Figures, ScreenHead, StateWord, TeamPicker } from "./ui";

const RATE_FORMAT = "Enter a rate from 0.000001 to 1000000 with at most six decimals.";
const TIME_FORMAT = "Use the format YYYY-MM-DD HH:MM.";
const LOCAL_MINUTES = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;

interface Ledger {
  balances: { granted_micro: number; available_micro: number; reserved_micro: number; settled_micro: number };
  movements: Movement[];
}

const KIND_WORDS: Record<string, string> = {
  opening_grant: "Opening grant", top_up: "Top-up", reserve: "Reserve", settle: "Settle", release: "Release",
};

const signed = (micro: number): string => (micro < 0 ? `−${credits(-micro)}` : `+${credits(micro)}`);

function TopUpForm() {
  const session = useSession();
  const { teamId, notify } = session;
  const [amount, setAmount] = useState("1000");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: Event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    notify("Recording payment…");
    const team = teamNameOf(session, teamId);
    try {
      const reply = await request<{ topup: Topup }>("POST", "/api/topups", {
        body: { team_id: teamId, credits: /^\d+$/.test(amount.trim()) ? Number(amount.trim()) : amount },
      });
      const whole = formatWholeCredits(reply.data.topup.credits);
      notify(reply.status === 202
        ? `Billing is unreachable. Your top-up of ${whole} credits is pending; no credits have been added yet.`
        : `Added ${whole} credits to ${team}.`);
      refreshAll();
    } catch (failure) {
      notify("");
      if (failure instanceof ApiError && failure.body.code === "billing_rejected") {
        setError("Billing declined the top-up; no credits were added.");
        refreshAll();
      } else if (failure instanceof ApiError && failure.body.fields) {
        setError(Object.values(failure.body.fields).join(" "));
      } else setError(failure instanceof ApiError ? failure.message : "The top-up did not reach Dispatch. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form class="panel inline-form" aria-label="Top up credits" onSubmit={submit} noValidate>
      <h2 class="panel__title inline-form__title">Top up credits</h2>
      <div class="field">
        <label for="topup-team">Team</label>
        <select id="topup-team" value={teamId} onChange={(e) => session.setTeamId(e.currentTarget.value)}>
          {session.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>
      <div class={`field${error ? " field--invalid" : ""}`}>
        <label for="topup-credits">Credits</label>
        <input id="topup-credits" type="number" class="input num" min={100} max={100000} step={100} value={amount}
          aria-describedby="topup-credits-help" onInput={(e) => setAmount(e.currentTarget.value)} />
        <p id="topup-credits-help" class="field__help"><Figures text="100 to 100,000 in steps of 100; 100 credits cost 1.00 USD." /></p>
      </div>
      <button type="submit" class="btn btn--primary" disabled={busy}>{busy ? "Recording payment…" : "Top up"}</button>
      <Alert text={error} />
    </form>
  );
}

function RateSchedule({ canEdit }: { canEdit: boolean }) {
  const session = useSession();
  const { models, notify } = session;
  const [slug, setSlug] = useState(models[0]?.slug ?? "");
  const [rateText, setRateText] = useState("");
  const [atText, setAtText] = useState("");
  const [errors, setErrors] = useState<{ rate?: string; at?: string }>({});
  const [alert, setAlert] = useState<string | null>(null);
  const [rates, setRates] = useState<Rate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const model = models.find((m) => m.slug === slug);

  usePoll(async () => {
    if (!slug) return;
    const { rates: listed } = await get<{ rates: Rate[] }>(`/api/models/${slug}/rates`);
    setRates(listed);
  }, 2000, [slug]);

  const schedule = async (event: Event) => {
    event.preventDefault();
    if (busy || !model) return;
    const micro = parseRateInput(rateText);
    const found: { rate?: string; at?: string } = {};
    if (micro === null) found.rate = RATE_FORMAT;
    if (!LOCAL_MINUTES.test(atText.trim())) found.at = TIME_FORMAT;
    setErrors(found);
    setAlert(null);
    if (micro === null || found.at) {
      document.getElementById(found.rate ? "rate-value" : "rate-at")?.focus();
      return;
    }
    setBusy(true);
    notify("Saving…");
    try {
      const { data } = await request<{ rate: Rate }>("POST", `/api/models/${model.slug}/rates`, {
        body: { micro_per_unit: Number(micro), effective_at_local: `${atText.trim().replace(" ", "T")}:00` },
      });
      const local = (data.rate.effective_at_local ?? `${atText.trim()}:00`).slice(0, 16).replace("T", " ");
      notify(`New rate for ${model.name} takes effect ${local} ${getOrgZone()}.`);
      setRateText("");
      setAtText("");
      refreshAll();
    } catch (failure) {
      notify("");
      if (failure instanceof ApiError && failure.body.fields) {
        const fields = failure.body.fields;
        setErrors({ rate: fields.micro_per_unit, at: fields.effective_at_local });
        setAlert("Fix the highlighted fields.");
      } else setAlert(failure instanceof ApiError ? failure.message : "The rate did not reach Dispatch. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async (id: string) => {
    setAlert(null);
    notify("Withdrawing…");
    try {
      await request("DELETE", `/api/models/${slug}/rates/${id}`);
      notify(`Scheduled rate ${id} withdrawn.`);
      refreshAll();
    } catch (failure) {
      notify("");
      setAlert(failure instanceof ApiError && failure.status === 409
        ? "That rate is already in effect and cannot be withdrawn."
        : failure instanceof ApiError ? failure.message : "The withdrawal did not reach Dispatch. Try again.");
    }
  };

  const modelSelect = (
    <div class="field">
      <label for="rate-model">Model</label>
      <select id="rate-model" value={slug} onChange={(e) => setSlug(e.currentTarget.value)}>
        {models.map((m) => <option key={m.slug} value={m.slug}>{m.name}</option>)}
      </select>
    </div>
  );

  return (
    <section class="panel">
      <header class="panel__head"><h2 class="panel__title">Rates</h2></header>
      {canEdit ? (
        <form class="inline-form inline-form--flat" aria-label="Schedule rate change" onSubmit={schedule} noValidate>
          {modelSelect}
          <div class={`field${errors.rate ? " field--invalid" : ""}`}>
            <label for="rate-value">New rate (credits per unit)</label>
            <input id="rate-value" type="text" inputMode="decimal" class="input num" value={rateText} placeholder="8.5"
              aria-invalid={errors.rate ? "true" : undefined} aria-describedby={errors.rate ? "rate-value-error" : undefined}
              onInput={(e) => setRateText(e.currentTarget.value)} />
            {errors.rate && <p id="rate-value-error" class="field__error">{errors.rate}</p>}
          </div>
          <div class={`field${errors.at ? " field--invalid" : ""}`}>
            <label for="rate-at">Effective at</label>
            <input id="rate-at" type="text" class="input num" value={atText} placeholder="2026-11-02 09:00"
              aria-invalid={errors.at ? "true" : undefined} aria-describedby={`rate-at-help${errors.at ? " rate-at-error" : ""}`}
              onInput={(e) => setAtText(e.currentTarget.value)} />
            {errors.at && <p id="rate-at-error" class="field__error">{errors.at}</p>}
            <p id="rate-at-help" class="field__help">Local time in {getOrgZone()}, <span class="num">24</span>-hour clock.</p>
          </div>
          <button type="submit" class="btn btn--primary" disabled={busy}>{busy ? "Saving…" : "Schedule"}</button>
        </form>
      ) : <div class="inline-form inline-form--flat">{modelSelect}</div>}
      <Alert text={alert} />
      <div class="table-wrap" tabIndex={0} role="region" aria-label="Rate schedule table">
        <table class="table" aria-label="Rate schedule">
          <thead>
            <tr>
              <th scope="col">Rate</th>
              <th scope="col" class="num-col">Credits per unit</th>
              <th scope="col">Effective at</th>
              <th scope="col">State</th>
              <th scope="col" class="fold">Set by</th>
              <th scope="col"><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rates === null && <tr><td colSpan={6} class="muted">Loading…</td></tr>}
            {rates?.map((r) => (
              <tr key={r.id}>
                <td class="num">{r.id}</td>
                <td class="num num-col">{formatRate(BigInt(r.micro_per_unit))}</td>
                <td class="num"><span class="nowrap">{r.effective_at_local.slice(0, 16).replace("T", " ")}</span> {getOrgZone()}</td>
                <td><StateWord word={capitalised(r.status)} tone={r.status === "past" ? "quiet" : undefined} /></td>
                <td class="fold">{r.created_by === null ? "Seed" : personName(r.created_by)}</td>
                <td>
                  {canEdit && r.status === "scheduled" && (
                    <button type="button" class="btn btn--quiet" aria-label={`Withdraw rate ${r.id}`} onClick={() => withdraw(r.id)}>
                      Withdraw
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function FinanceScreen() {
  const session = useSession();
  const { me, teamId } = session;
  const finance = me.role === "finance";
  const [topups, setTopups] = useState<Topup[] | null>(null);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [openJob, setOpenJob] = useState<string | null>(null);

  usePoll(async () => {
    const [t, l] = await Promise.all([
      get<{ topups: Topup[] }>(`/api/topups${query({ team: teamId })}`),
      get<Ledger>(`/api/teams/${teamId}/ledger`),
    ]);
    setTopups(t.topups);
    setLedger(l);
  }, 2000, [teamId]);

  return (
    <div class="screen">
      <ScreenHead title="Finance"><TeamPicker id="finance-team" /></ScreenHead>
      <CreditMeter teamId={teamId} teamName={teamNameOf(session, teamId)} onOpenJob={setOpenJob} />
      {finance && <TopUpForm />}
      <section class="panel">
        <header class="panel__head"><h2 class="panel__title">Top-ups</h2></header>
        <div class="table-wrap" tabIndex={0} role="region" aria-label="Top-ups table">
          <table class="table" aria-label="Top-ups">
            <thead>
              <tr>
                <th scope="col">Top-up</th>
                <th scope="col" class="num-col">Credits</th>
                <th scope="col" class="num-col fold">Amount (USD)</th>
                <th scope="col">State</th>
                <th scope="col">Kill Bill invoice</th>
                <th scope="col" class="fold">Requested</th>
                <th scope="col" class="fold">Paid</th>
              </tr>
            </thead>
            <tbody>
              {topups === null && <tr><td colSpan={7} class="muted">Loading…</td></tr>}
              {topups?.length === 0 && <tr><td colSpan={7} class="muted">No top-ups yet.</td></tr>}
              {topups?.map((t) => (
                <tr key={t.id}>
                  <td class="num">{t.id}</td>
                  <td class="num num-col">{formatWholeCredits(t.credits)}</td>
                  <td class="num num-col fold">{t.amount_usd}</td>
                  <td><StateWord word={capitalised(t.status)} tone={t.status === "paid" ? undefined : "alert"} /></td>
                  <td class="num id-cell">{t.kb_invoice_id ?? (t.pending_reason ?? t.failure_reason ?? "—")}</td>
                  <td class="fold num">{when(t.created_at)}</td>
                  <td class="fold num">{when(t.paid_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section class="panel">
        <header class="panel__head">
          <h2 class="panel__title">Ledger</h2>
          <a class="btn btn--secondary" href={`/api/teams/${teamId}/ledger.csv`} download>Export ledger CSV</a>
        </header>
        <div class="table-wrap" tabIndex={0} role="region" aria-label="Ledger table">
          <table class="table" aria-label="Ledger">
            <thead>
              <tr>
                <th scope="col">Movement</th>
                <th scope="col">Kind</th>
                <th scope="col" class="fold">Created</th>
                <th scope="col" class="fold">Job or top-up</th>
                <th scope="col" class="fold">Kill Bill invoice</th>
                <th scope="col" class="num-col">Entries (credits)</th>
              </tr>
            </thead>
            <tbody>
              {ledger === null && <tr><td colSpan={6} class="muted">Loading…</td></tr>}
              {ledger && [...ledger.movements].reverse().map((m) => (
                <tr key={m.id}>
                  <td class="num">{m.id}</td>
                  <td>{KIND_WORDS[m.kind] ?? m.kind}</td>
                  <td class="fold num">{when(m.created_at)}</td>
                  <td class="fold num">{m.job_id ?? m.topup_id ?? "—"}</td>
                  <td class="fold num id-cell">{m.kb_invoice_id ?? "—"}</td>
                  <td class="num num-col">
                    {m.entries.map((e) => (
                      <span key={e.account} class="entry"><span class="entry__account">{e.account}</span> {signed(e.amount_micro)}</span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <RateSchedule canEdit={finance} />
      <JobDialog jobId={openJob} onClose={() => setOpenJob(null)} />
    </div>
  );
}
