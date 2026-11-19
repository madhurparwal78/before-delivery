// Settings (brief: Screens and layout; DP-55, DP-56): effective-dated bin retention and partner grant length.
import { useEffect, useRef, useState } from "react";
import { api, call, ApiError } from "../api";
import { announce } from "../announce";
import { changes, coalesce } from "../data";
import { POLICY_STARTED, SOMETHING_WRONG } from "../copy";
import { Notices, ServiceBanner } from "../shell/Frame";
import type { Policy, PolicyKind } from "../../shared/api";

const KIND: Record<PolicyKind, { title: string; button: string; noun: string; announce: string }> = {
  bin_retention_days: { title: "Bin retention", button: "Schedule bin retention", noun: "bin retention", announce: "Bin retention" },
  partner_grant_days: { title: "Partner grant length", button: "Schedule grant length", noun: "grant length", announce: "Partner grant length" },
};
const STATE: Record<Policy["state"], string> = { in_force: "In force", scheduled: "Scheduled", past: "Past" };

function PolicyForm({ kind, onDone }: { kind: PolicyKind; onDone: () => void }) {
  const [days, setDays] = useState("");
  const [from, setFrom] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const daysRef = useRef<HTMLInputElement>(null);
  const fromRef = useRef<HTMLInputElement>(null);
  const id = kind === "bin_retention_days" ? "bin" : "grant";

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const body = await api<{ policy: Policy }>("POST", "/api/policies", { kind, days: days.trim() === "" ? null : Number(days), effectiveFrom: from });
      announce(`${KIND[kind].announce} changes to ${body.policy.days} days from ${body.policy.effectiveFrom}`);
      setErrors({});
      setDays("");
      setFrom("");
      onDone();
    } catch (failure) {
      if (!(failure instanceof ApiError)) throw failure;
      const fields = failure.code === "policy_exists" ? { effectiveFrom: `A change is already scheduled for ${from}.` }
        : failure.status === 422 ? failure.body.fields ?? {} : {};
      if (!Object.keys(fields).length) {
        announce(SOMETHING_WRONG);
        return;
      }
      setErrors(fields);
      (fields.days ? daysRef.current : fromRef.current)?.focus();
    }
  };

  return (
    <form aria-label={KIND[kind].title} className="policy-form" onSubmit={submit} noValidate>
      <h2 className="pane-title">{KIND[kind].title}</h2>
      <div className="field">
        <label htmlFor={`${id}-days`}>Days</label>
        <input ref={daysRef} id={`${id}-days`} type="number" inputMode="numeric" min={1} max={kind === "bin_retention_days" ? 90 : 365} step={1}
          className="field-input num narrow" value={days} aria-invalid={errors.days ? true : undefined}
          aria-describedby={errors.days ? `${id}-days-error` : undefined} onChange={(e) => setDays(e.target.value)} />
        {errors.days && <p id={`${id}-days-error`} className="field-error">{errors.days}</p>}
      </div>
      <div className="field">
        <label htmlFor={`${id}-from`}>Effective from</label>
        <input ref={fromRef} id={`${id}-from`} type="date" className="field-input num" value={from} aria-invalid={errors.effectiveFrom ? true : undefined}
          aria-describedby={errors.effectiveFrom ? `${id}-from-error` : undefined} onChange={(e) => setFrom(e.target.value)} />
        {errors.effectiveFrom && <p id={`${id}-from-error`} className="field-error">{errors.effectiveFrom}</p>}
      </div>
      <button type="submit" className="button primary">{KIND[kind].button}</button>
    </form>
  );
}

export function SettingsScreen() {
  const [policies, setPolicies] = useState<Policy[] | null>(null);
  const [today, setToday] = useState("");
  const load = useRef(coalesce(() => {
    void api<{ today: string; policies: Policy[] }>("GET", "/api/policies").then((body) => {
      setPolicies(body.policies);
      setToday(body.today);
    }, () => undefined);
  }));

  useEffect(() => {
    load.current();
    return changes.on("change", (kind) => {
      if (kind === "policies" || kind === "day" || kind === "all") load.current();
    });
  }, []);

  const withdraw = async (policy: Policy) => {
    try {
      await call("DELETE", `/api/policies/${policy.id}`);
      announce(`Withdrew the change from ${policy.effectiveFrom}`);
    } catch (failure) {
      if (!(failure instanceof ApiError)) throw failure;
      announce(failure.code === "policy_started" ? POLICY_STARTED : SOMETHING_WRONG);
    }
    load.current();
  };

  return (
    <main className="centre centre-plain" id="files" tabIndex={-1}>
      <div className="page-head"><h1>Settings</h1><p className="page-sub">Changes start at Phoenix midnight on their date. Items binned or granted before then keep the rule they were given<span style={today ? undefined : { visibility: "hidden" }}> · today is <span className="num">{today || "0000-00-00"}</span></span>.</p></div>
      <Notices />
      <ServiceBanner />
      <div className="policy-forms">
        <PolicyForm kind="bin_retention_days" onDone={() => load.current()} />
        <PolicyForm kind="partner_grant_days" onDone={() => load.current()} />
      </div>
      {policies && (
        <table aria-label="Policy schedule" className="table">
          <thead><tr><th scope="col">Kind</th><th scope="col">Days</th><th scope="col">Effective from</th><th scope="col">State</th><th scope="col"><span className="visually-hidden">Actions</span></th></tr></thead>
          <tbody>
            {policies.map((p) => (
              <tr key={p.id} className={p.state === "in_force" ? "is-current-row" : ""}>
                <td data-label="Kind">{KIND[p.kind].title}</td>
                <td data-label="Days" className="num">{p.days}</td>
                <td data-label="Effective from" className="num">{p.effectiveFrom}</td>
                <td data-label="State">{STATE[p.state]}</td>
                <td className="cell-actions">
                  {p.state === "scheduled" && (
                    <button type="button" className="button compact" aria-label={`Withdraw ${KIND[p.kind].noun} from ${p.effectiveFrom}`} onClick={() => void withdraw(p)}>Withdraw</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
