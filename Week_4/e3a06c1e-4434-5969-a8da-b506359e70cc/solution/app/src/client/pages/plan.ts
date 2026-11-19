// The organisation's plan: the confirmed plan with its Active badge, any open change, one switch.
import type { OrgPlan } from "../../shared/types";
import { CENTS_PER_MINUTE, dollarsText, PLAN_TITLE, type Plan } from "../../shared/billing";
import { api, GENERIC_FAILURE, setOutage } from "../api";
import { h, replace, say } from "../dom";
import type { Page } from "../main";

const RULE: Record<Plan, string> = {
  pilot: "Each session rounds up to whole minutes, per channel.",
  scale: "Billed per second with a 15-second minimum, per channel.",
};
const OUTAGE = "Billing is unreachable, so your plan hasn't changed. Try again in a minute.";

export function renderPlan(page: Page): void {
  const region = h("section", { "aria-label": "Current plan", class: "plan-card" }, h("p", { class: "skeleton-text" }, "Loading the plan"));
  const status = h("p", { role: "status", "aria-label": "Plan status", class: "status-line" });
  const switchButton = h("button", { type: "button", class: "primary", hidden: true });
  page.root.append(
    h("header", { class: "page-head" }, h("div", {}, h("h1", {}, "Plan"), h("p", { class: "muted" }, "A change counts only once billing confirms it. Sessions keep the plan in force when they started."))),
    region,
    h("div", { class: "plan-actions" }, switchButton, status),
  );
  let shown: OrgPlan | null = null;
  let watching: string | null = null;
  // One Idempotency-Key from the first press, reused by every retry until a 202 or a 409 arrives.
  let requestKey: string | null = null;

  const paint = (plan: OrgPlan) => {
    shown = plan;
    setOutage("billing", !plan.billing_reachable);
    const open = plan.change?.state === "requested" ? plan.change : null;
    replace(
      region,
      h("div", { class: "plan-title" }, h("h2", {}, PLAN_TITLE[plan.plan]), h("span", { class: "badge accent" }, "Active")),
      h("p", { class: "num" }, `${dollarsText(CENTS_PER_MINUTE[plan.plan])} per billable minute`),
      h("p", {}, RULE[plan.plan]),
      open ? h("p", { class: "pending-change" }, h("span", { class: "badge caution" }, "Waiting for billing"), ` Change to ${PLAN_TITLE[open.target]} requested.`) : null,
    );
    const target: Plan = plan.plan === "pilot" ? "scale" : "pilot";
    switchButton.hidden = false;
    say(switchButton, `Switch to ${PLAN_TITLE[target]}`);
    switchButton.dataset.target = target;
    switchButton.disabled = open !== null;
    if (watching && plan.change?.id === watching && plan.change.state !== "requested") {
      say(status, plan.change.state === "confirmed" ? `${PLAN_TITLE[plan.change.target]} plan is active.` : `Billing declined the change. You're still on the ${PLAN_TITLE[plan.plan]} plan.`);
      watching = null;
    }
  };

  const load = async () => {
    const found = await api<OrgPlan>("GET", "/api/org/plan");
    if (found.ok && page.current()) paint(found.data);
  };
  void load();
  const poll = setInterval(() => void load(), 1000);
  page.onLeave(() => clearInterval(poll));

  switchButton.addEventListener("click", async () => {
    if (!shown) return;
    const target = switchButton.dataset.target as Plan;
    switchButton.disabled = true;
    requestKey ??= crypto.randomUUID();
    const result = await api<{ change: { id: string; target: Plan; state: string } }>("POST", "/api/org/plan-changes", { plan: target }, { headers: { "Idempotency-Key": requestKey } });
    if (!page.current()) return;
    if (result.status === 202 || result.status === 409) requestKey = null;
    if (result.ok) {
      watching = result.data.change.id;
      say(status, `Waiting for billing to confirm the ${PLAN_TITLE[target]} plan.`);
    } else if (result.error.error === "billing_unavailable") {
      setOutage("billing", true);
      say(status, OUTAGE);
    } else if (result.error.error === "change_pending") say(status, `Waiting for billing to confirm the ${PLAN_TITLE[target]} plan.`);
    else say(status, GENERIC_FAILURE);
    await load();
  });
}
