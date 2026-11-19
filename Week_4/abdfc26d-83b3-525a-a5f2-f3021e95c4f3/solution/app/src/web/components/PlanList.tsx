import { useCallback, useEffect, useRef, useState } from "react";
import { CREDIT_PACK, PLANS, type PlanCode } from "../../shared/rules";
import { api, IdempotentAction, type Credits, type Plan } from "../api";
import { copy, money } from "../copy";
import { Link } from "../router";
import { LiveStatus, useAnnouncer } from "./ui";

const NOTES: Record<PlanCode, string> = {
  "studio-monthly": "For a nightly practice: 300 render credits each month.",
  "pro-monthly": "For long exports at 1080p: 1,500 render credits each month.",
};
const PLAN_ROWS = (Object.keys(PLANS) as PlanCode[]).map((code) => ({ code, ...PLANS[code], note: NOTES[code] }));
const PACK = CREDIT_PACK;

const planName = (code: Plan["code"]): string => PLANS[code].name;

/** The plan and credit list. `compact` is the landing page's read-only version that links to the studio. */
export function PlanList({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <ul className="plan-list" aria-label="Plans and credits">
        {PLAN_ROWS.map((plan) => (
          <li key={plan.code} className="plan-row">
            <span className="plan-title">{plan.name}</span>
            <span className="plan-note muted">{plan.note}</span>
            <span className="plan-price tabular">{money(plan.priceCents)} / month</span>
            <Link to="/studio/credits" className="arrow-link">See {plan.name}</Link>
          </li>
        ))}
        <li className="plan-row">
          <span className="plan-title">500 credits</span>
          <span className="plan-note muted">A one-off pack for a heavy week of renders.</span>
          <span className="plan-price tabular">{money(PACK.priceCents)}</span>
          <Link to="/studio/credits" className="arrow-link">See packs</Link>
        </li>
      </ul>
    );
  }
  return <PlanManager />;
}

function PlanManager() {
  const announcer = useAnnouncer();
  const { say } = announcer;
  const [plan, setPlan] = useState<Plan | null>(null);
  const [credits, setCredits] = useState<Credits | null>(null);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState<{ kind: "plan" } | { kind: "pack"; id: string } | null>(null);
  const packAction = useRef(new IdempotentAction());

  const load = useCallback(async () => {
    const [p, c] = await Promise.all([api<{ plan: Plan | null }>("GET", "/api/me/plan"), api<Credits>("GET", "/api/me/credits")]);
    if (p.ok) setPlan(p.data.plan);
    if (c.ok) setCredits(c.data);
    return p.ok ? p.data.plan : null;
  }, []);

  useEffect(() => {
    void load().then((current) => {
      if (current?.state === "pending_payment") setWaiting({ kind: "plan" });
    });
  }, [load]);

  // re-read every 2 seconds until Kill Bill's confirmation shows
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(async () => {
      if (waiting.kind === "plan") {
        const current = await load();
        if (current?.state === "active") {
          say(copy.planActive(planName(current.code)));
          setWaiting(null);
        }
        return;
      }
      const result = await api<{ purchase: { state: string } }>("GET", `/api/me/credit-packs/${waiting.id}`);
      if (result.ok && result.data.purchase.state !== "paying") {
        say(result.data.purchase.state === "paid" ? copy.packAdded : "Kill Bill reported the pack payment as failed. Nothing was charged to your credits.");
        setWaiting(null);
        void load();
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [waiting, load, say]);

  const outage = (status: number, message: string) =>
    say(status === 503 ? "Plan changes and credit packs are paused while Kill Bill is unreachable. Try again in a minute." : message);

  const choose = async (code: Plan["code"]) => {
    setBusy(true);
    const result = await api<{ plan: Plan }>("POST", "/api/me/plan", { plan: code });
    setBusy(false);
    if (!result.ok) return outage(result.status, result.error.message);
    setPlan(result.data.plan);
    say(copy.planPending);
    setWaiting({ kind: "plan" });
  };

  const buyPack = async () => {
    setBusy(true);
    const result = await packAction.current.send<{ purchase: { id: string } }>("POST", "/api/me/credit-packs", { pack: PACK.code });
    setBusy(false);
    if (!result.ok) return outage(result.status, result.error.message);
    say(copy.planPending);
    setWaiting({ kind: "pack", id: result.data.purchase.id });
  };

  const cancel = async () => {
    setBusy(true);
    const result = await api<{ plan: Plan }>("POST", "/api/me/plan/cancel");
    setBusy(false);
    if (result.ok) {
      setPlan(result.data.plan);
      say(copy.planEnds(result.data.plan.ends_on ?? ""));
    } else if (result.error.code === "plan_not_confirmed") say(copy.planUnconfirmed);
    else outage(result.status, result.error.message);
  };

  const open = plan && (plan.state === "pending_payment" || plan.state === "active" || plan.state === "cancelling");
  const stateWords: Record<Plan["state"], string> = {
    pending_payment: "Waiting for Kill Bill",
    active: "Active",
    cancelling: `Ends on ${plan?.ends_on ?? ""}`,
    ended: "Ended",
  };

  return (
    <div className="plan-manager">
      <div className="balance-strip">
        <p><span className="balance-figure tabular">{credits?.available ?? "—"}</span> credits available</p>
        <p className="muted"><span className="tabular">{credits?.held ?? "—"}</span> reserved for renders in progress</p>
        <p className="muted">{plan && open ? `${planName(plan.code)} plan · ${stateWords[plan.state]}` : "No plan"}</p>
      </div>
      <ul className="plan-list" aria-label="Plans and credits">
        {PLAN_ROWS.map((p) => (
          <li key={p.code} className={`plan-row ${plan?.code === p.code && open ? "is-current" : ""}`}>
            <span className="plan-title">{p.name}</span>
            <span className="plan-note muted">{p.note}</span>
            <span className="plan-price tabular">{money(p.priceCents)} / month</span>
            {plan?.code === p.code && open ? (
              <span className="plan-state">{stateWords[plan.state]}</span>
            ) : (
              <button type="button" className="button button-ghost" disabled={busy} onClick={() => void choose(p.code)}>
                Choose {p.name}
              </button>
            )}
          </li>
        ))}
        <li className="plan-row">
          <span className="plan-title">500 credits</span>
          <span className="plan-note muted">A one-off pack, granted once Kill Bill confirms the payment.</span>
          <span className="plan-price tabular">{money(PACK.priceCents)}</span>
          <button type="button" className="button button-ghost" disabled={busy} onClick={() => void buyPack()}>
            Buy 500 credits
          </button>
        </li>
        {plan && (plan.state === "pending_payment" || plan.state === "active") ? (
          <li className="plan-row">
            <span className="plan-title">Your plan</span>
            <span className="plan-note muted">Cancelling keeps the plan to the end of the term Kill Bill already charged.</span>
            <span className="plan-price">{planName(plan.code)}</span>
            <button type="button" className="button button-ghost" disabled={busy} onClick={() => void cancel()}>
              Cancel plan
            </button>
          </li>
        ) : null}
      </ul>
      <LiveStatus label="Plan status" announcer={announcer} />
    </div>
  );
}
