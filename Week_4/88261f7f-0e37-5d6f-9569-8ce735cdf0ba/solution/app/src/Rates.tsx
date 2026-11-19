import { useCallback, useEffect, useState } from "react";
import type { RatePlan, TaxRate } from "../shared/api";
import { dollarsText, parseDollars } from "../shared/money";
import { call, get, post } from "./api";
import { useBusy } from "./hooks";
import { useLive } from "./live";
import { TopBar } from "./Shell";
import { FieldMessage } from "./ui";

export function Rates() {
  const [plans, setPlans] = useState<RatePlan[]>([]);
  const [rates, setRates] = useState<TaxRate[]>([]);
  const [status, setStatus] = useState("");
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const [planAnswer, rateAnswer] = await Promise.all([get<{ ratePlans: RatePlan[] }>("/api/rate-plans"), get<{ taxRates: TaxRate[] }>("/api/tax-rates")]);
    if (planAnswer.ok) setPlans(planAnswer.data.ratePlans);
    if (rateAnswer.ok) setRates(rateAnswer.data.taxRates);
    setLoaded(true);
  }, []);
  useEffect(() => void load(), [load]);
  useLive(() => void load());

  return (
    <>
      <TopBar />
      <main className="page two-column">
        <div role="status" aria-label="Rates status" className="notice">{status}</div>
        <div className="column-left">
          <h1>Rates</h1>
          {/* The forms appear together once the plans are known, so nothing below them moves when they land. */}
          {loaded ? plans.map((plan) => <PlanForm key={`${plan.id}-${plan.weeknightCents}-${plan.weekendCents}`} plan={plan} onStatus={setStatus} onSaved={load} />) : null}
          {loaded ? <TaxForm onStatus={setStatus} onSaved={load} /> : null}
        </div>
        {loaded ? <div className="column-right">
          <h2>Tax rates</h2>
          <div className="table-frame" tabIndex={0} role="group" aria-label="Tax rates, scrollable">
            <table aria-label="Tax rates" className="ledger compact-table">
              <thead><tr><th scope="col" className="money-head">Rate</th><th scope="col">Starts on</th></tr></thead>
              <tbody>
                {rates.map((rate) => (
                  <tr key={rate.id}><td className="money">{rate.percent}%</td><td>{rate.startDate ?? "—"}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div> : null}
      </main>
    </>
  );
}

function PlanForm({ plan, onStatus, onSaved }: { plan: RatePlan; onStatus: (text: string) => void; onSaved: () => Promise<void> }) {
  const [weeknight, setWeeknight] = useState(dollarsText(plan.weeknightCents));
  const [weekend, setWeekend] = useState(dollarsText(plan.weekendCents));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, guard] = useBusy();

  const save = (): void =>
    void guard(async () => {
      onStatus("Saving rates…");
      setErrors({});
      const answer = await call("PATCH", `/api/rate-plans/${plan.id}`, { weeknightCents: parseDollars(weeknight) ?? 0, weekendCents: parseDollars(weekend) ?? 0 });
      if (!answer.ok) {
        setErrors(answer.errors);
        onStatus(Object.values(answer.errors)[0] ?? answer.error);
        return;
      }
      onStatus("Rates saved.");
      await onSaved();
    });

  return (
    <fieldset className="sheet">
      <legend>{plan.name}</legend>
      <label>
        {plan.name} weeknight price
        <input type="text" inputMode="decimal" value={weeknight} onChange={(event) => setWeeknight(event.target.value)} />
      </label>
      <FieldMessage message={errors.weeknightCents} />
      <label>
        {plan.name} weekend price
        <input type="text" inputMode="decimal" value={weekend} onChange={(event) => setWeekend(event.target.value)} />
      </label>
      <FieldMessage message={errors.weekendCents} />
      <button type="button" aria-busy={busy} onClick={save}>Save {plan.name}</button>
    </fieldset>
  );
}

function TaxForm({ onStatus, onSaved }: { onStatus: (text: string) => void; onSaved: () => Promise<void> }) {
  const [percent, setPercent] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, guard] = useBusy();

  const save = (): void =>
    void guard(async () => {
      onStatus("Saving rates…");
      setErrors({});
      const answer = await post("/api/tax-rates", { percent, startDate: startsOn });
      if (!answer.ok) {
        setErrors(answer.errors);
        onStatus(Object.values(answer.errors)[0] ?? answer.error);
        return;
      }
      onStatus("Rates saved.");
      await onSaved();
    });

  return (
    <fieldset className="sheet">
      <legend>Tax rate</legend>
      <label>
        Tax rate percent
        <input type="text" inputMode="decimal" value={percent} onChange={(event) => setPercent(event.target.value)} />
      </label>
      <FieldMessage message={errors.percent} />
      <label>
        Starts on
        <input type="text" placeholder="YYYY-MM-DD" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} />
      </label>
      <FieldMessage message={errors.startDate} />
      <button type="button" aria-busy={busy} onClick={save}>Save tax rate</button>
    </fieldset>
  );
}
