// The Missions page.

import {
  dayOfYearToEpochMs,
  epochMsToIso,
  formatMoney,
  formatSize,
  isDayOfYear,
  planRadioLabel,
  planPriceText,
  PLAN_CATALOGUE,
  type PlanDefinition,
  type PlanId,
} from "../shared/format.js";
import { api, el, announce, text } from "./browser.js";

interface ApiPlan {
  plan: PlanId;
  label: string;
  price_cents: number;
  period: "month" | "year";
  quota_bytes: number;
  used_bytes: number;
  next_billing_date: string | null;
  balance_cents: number | null;
}

export async function missionsMain(): Promise<void> {
  const list = el<HTMLOListElement>("missions-list");
  const nameInput = el<HTMLInputElement>("mission-name");
  const epochInput = el<HTMLInputElement>("mission-epoch");
  const nameError = el("mission-name-error");
  const epochError = el("mission-epoch-error");
  const planLines = el("plan-lines");
  const planRadios = el("plan-radios");
  const changePlan = el<HTMLButtonElement>("change-plan");
  const planStatus = el("plan-status");
  const banners = el("banners");

  function setField(errorEl: HTMLElement, input: HTMLElement, message: string | null): void {
    if (message === null) {
      errorEl.textContent = "";
      errorEl.hidden = true;
      input.removeAttribute("aria-invalid");
      input.removeAttribute("aria-errormessage");
    } else {
      errorEl.textContent = message;
      errorEl.hidden = false;
      input.setAttribute("aria-invalid", "true");
      input.setAttribute("aria-errormessage", errorEl.id);
    }
  }

  async function loadMissions(): Promise<void> {
    const result = await api<{ missions: Array<{ id: string; name: string }> }>("/api/missions");
    list.textContent = "";
    for (const mission of result.body?.missions ?? []) {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = `/missions/${mission.id}`;
      a.textContent = mission.name;
      li.append(a);
      list.append(li);
    }
  }

  const form = el("new-mission");
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void (async () => {
      setField(nameError, nameInput, null);
      setField(epochError, epochInput, null);
      if (!isDayOfYear(epochInput.value)) {
        setField(epochError, epochInput, "Use GMT day-of-year: YYYY-DDD/HH:MM:SS.");
        epochInput.focus();
        return;
      }
      const epochMs = dayOfYearToEpochMs(epochInput.value);
      const result = await api<{ id: string; name: string } & { errors?: Record<string, string> }>(
        "/api/missions",
        { method: "POST", body: JSON.stringify({ name: nameInput.value, epoch_utc: epochMs === null ? null : epochMsToIso(epochMs) }) },
      );
      if (result.ok && result.body?.id) {
        window.location.href = `/missions/${result.body.id}`;
        return;
      }
      const errors = result.body?.errors ?? {};
      let focused = false;
      if (errors.name) {
        setField(nameError, nameInput, errors.name);
        nameInput.focus();
        focused = true;
      }
      if (errors.epoch_utc) {
        setField(epochError, epochInput, errors.epoch_utc);
        if (!focused) epochInput.focus();
        focused = true;
      }
      if (!focused) {
        setField(nameError, nameInput, "Enter a mission name of 1 to 80 characters.");
        nameInput.focus();
      }
    })();
  });

  // Plan radios.
  for (const def of PLAN_CATALOGUE) {
    const label = document.createElement("label");
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "plan";
    radio.value = def.plan;
    label.append(radio, ` ${planRadioLabel(def)}`);
    planRadios.append(label);
  }

  let currentPlan: PlanId = "archive-free";
  let planPending = false;

  function renderPlan(plan: ApiPlan): void {
    currentPlan = plan.plan;
    const price = planPriceText({
      plan: plan.plan,
      label: plan.label,
      price_cents: plan.price_cents,
      period: plan.period,
      quota_bytes: plan.quota_bytes,
    });
    planLines.textContent = "";
    const lines = [
      `Plan ${plan.label}: ${price}`,
      `Used ${formatSize(plan.used_bytes)} of ${formatSize(plan.quota_bytes)}`,
      `Next invoice ${plan.next_billing_date ?? "—"}`,
      `Balance ${plan.balance_cents === null ? "—" : `${formatMoney(plan.balance_cents)} USD`}`,
    ];
    for (const line of lines) {
      const p = document.createElement("p");
      p.className = "num";
      text(p, line);
      planLines.append(p);
    }
    for (const radio of planRadios.querySelectorAll<HTMLInputElement>("input[name='plan']")) {
      radio.checked = radio.value === plan.plan;
    }
  }

  async function loadPlan(): Promise<void> {
    const result = await api<ApiPlan>("/api/plan");
    if (result.ok && result.body) renderPlan(result.body);
  }

  changePlan.addEventListener("click", () => {
    void (async () => {
      if (planPending) return;
      const checked = planRadios.querySelector<HTMLInputElement>("input[name='plan']:checked");
      if (!checked) return;
      const chosen = checked.value as PlanId;
      if (chosen === currentPlan) return;
      planPending = true;
      changePlan.disabled = true;
      for (const radio of planRadios.querySelectorAll<HTMLInputElement>("input")) radio.disabled = true;
      announce(planStatus, "Changing plan...");
      const result = await api<ApiPlan & { error?: string; quota_bytes?: number; used_bytes?: number }>("/api/plan", {
        method: "PUT",
        body: JSON.stringify({ plan: chosen }),
      });
      planPending = false;
      changePlan.disabled = false;
      for (const radio of planRadios.querySelectorAll<HTMLInputElement>("input")) radio.disabled = false;
      if (result.ok && result.body?.plan) {
        renderPlan(result.body);
        announce(planStatus, `Plan changed to ${result.body.label}.`);
      } else {
        const body = result.body as { error?: string; quota_bytes?: number; used_bytes?: number } | null;
        if (body?.error === "plan_too_small") {
          const label = PLAN_CATALOGUE.find((p) => p.plan === chosen)?.label ?? chosen;
          announce(
            planStatus,
            `${label} holds ${formatSize(body.quota_bytes ?? 0)}, and ${formatSize(body.used_bytes ?? 0)} is stored.`,
          );
        } else {
          announce(planStatus, "The plan was not changed. Billing did not confirm it.");
        }
        await loadPlan();
      }
    })();
  });

  async function loadBanners(): Promise<void> {
    const result = await api<{ billing: string }>("/api/status");
    if (!result.ok || !result.body) return;
    banners.textContent = "";
    if (result.body.billing === "down") {
      const alert = document.createElement("div");
      alert.setAttribute("role", "alert");
      alert.textContent =
        "Billing is offline. Uploads keep your current quota; plan changes are paused.";
      banners.append(alert);
    }
  }

  await Promise.all([loadMissions(), loadPlan(), loadBanners()]);
  setInterval(() => {
    void loadBanners();
    if (!planPending) void loadPlan();
  }, 10000);
}
