/** The Missions page: the missions list, the New mission form and the Archive plan region. */

import { parseDoyToIso } from "../shared/doy.js";
import { fieldErrors, banners, planCopy, EM_DASH } from "../shared/copy.js";
import { formatSize, formatMoney } from "../shared/sizes.js";
import { PLANS, planPrice } from "../shared/plans.js";
import type { Mission, Plan, PlanId, ServiceStatus } from "../shared/model.js";
import { announce, clear, el, fieldError, liveRegion, showInitialView } from "./dom.js";
import { getJson, request } from "./api.js";

const STATUS_INTERVAL_MS = 10_000;

export function renderMissionsPage(root: HTMLElement): void {
  clear(root);
  const heading = el("h1", { text: "Missions" });
  const bannerBox = el("div", { class: "banners" });
  const list = el("ul", { class: "missions", "aria-label": "Missions" });
  const nameInput = el("input", {
    id: "mission-name",
    type: "text",
    class: "text",
    "aria-label": "Mission name",
  });
  const epochInput = el("input", {
    id: "mission-epoch",
    type: "text",
    class: "text mono",
    placeholder: "2026-073/00:00:00",
    "aria-label": "Epoch (GMT)",
  });
  const createButton = el("button", { type: "submit", class: "primary", text: "Create mission" });
  const form = el("form", { class: "new-mission" }, [
    el("h2", { text: "New mission" }),
    el("label", { for: "mission-name", text: "Mission name" }),
    nameInput,
    el("label", { for: "mission-epoch", text: "Epoch (GMT)" }),
    epochInput,
    createButton,
  ]);

  const planStatus = liveRegion("Plan status");
  const planLines = el("div", { class: "plan-lines mono" });
  const planRadios = PLANS.map((plan) => {
    const input = el("input", {
      type: "radio",
      name: "plan",
      id: `plan-${plan.plan}`,
      value: plan.plan,
    });
    const label =
      plan.plan === "archive-free"
        ? `${plan.label}, ${formatSize(plan.quota_bytes)}`
        : `${plan.label}, ${planPrice(plan)}`;
    return {
      plan: plan.plan,
      input,
      row: el("div", { class: "radio-row" }, [
        input,
        el("label", { for: `plan-${plan.plan}`, text: label }),
      ]),
    };
  });
  const changeButton = el("button", { type: "button", class: "primary", text: "Change plan" });
  const planRegion = el("section", { class: "region plan", "aria-label": "Archive plan" }, [
    el("h2", { text: "Archive plan" }),
    planLines,
    el(
      "div",
      { role: "radiogroup", "aria-label": "Plan", class: "radiogroup" },
      planRadios.map((radio) => radio.row),
    ),
    changeButton,
    planStatus,
  ]);

  root.append(heading, bannerBox, list, form, planRegion);

  let currentPlan: PlanId = "archive-free";
  let pending = false;

  const showPlan = (plan: Plan): void => {
    clear(planLines);
    planLines.append(
      el("p", { text: `Plan ${plan.label}: ${planPrice(plan)}` }),
      el("p", {
        text: `Used ${formatSize(plan.used_bytes)} of ${formatSize(plan.quota_bytes)}`,
      }),
      el("p", { text: `Next invoice ${plan.next_billing_date ?? EM_DASH}` }),
      el("p", {
        text: `Balance ${
          plan.balance_cents === null ? EM_DASH : `${formatMoney(plan.balance_cents)} USD`
        }`,
      }),
    );
    currentPlan = plan.plan;
    for (const radio of planRadios) {
      radio.input.checked = radio.plan === plan.plan;
    }
  };

  const loadPlan = async (): Promise<void> => {
    const result = await getJson<Plan>("/api/plan");
    if (result.ok && !pending) {
      showPlan(result.data);
    }
  };

  const loadMissions = async (): Promise<void> => {
    const result = await getJson<{ missions: Mission[] }>("/api/missions");
    if (!result.ok) {
      return;
    }
    clear(list);
    for (const mission of result.data.missions) {
      list.append(
        el("li", {}, [
          el("a", { href: `/missions/${mission.id}`, text: mission.name }),
        ]),
      );
    }
  };

  const loadStatus = async (): Promise<void> => {
    const result = await getJson<ServiceStatus>("/api/status");
    if (!result.ok) {
      return;
    }
    clear(bannerBox);
    if (result.data.billing === "down") {
      bannerBox.append(el("p", { role: "alert", class: "banner", text: banners.billing }));
    }
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void createMission();
  });

  const createMission = async (): Promise<void> => {
    fieldError(epochInput, null);
    fieldError(nameInput, null);
    const epochIso = parseDoyToIso(epochInput.value);
    if (epochIso === null) {
      fieldError(epochInput, fieldErrors.dayOfYear);
      epochInput.focus();
      return;
    }
    const result = await request<Mission>("POST", "/api/missions", {
      body: { name: nameInput.value, epoch_utc: epochIso },
    });
    if (result.ok) {
      window.location.assign(`/missions/${result.data.id}`);
      return;
    }
    if (result.code === "validation") {
      const fields: [string, HTMLElement][] = [
        ["name", nameInput],
        ["epoch_utc", epochInput],
      ];
      let focused = false;
      for (const [field, input] of fields) {
        const message = result.errors[field];
        if (message) {
          fieldError(input, message);
          if (!focused) {
            input.focus();
            focused = true;
          }
        }
      }
    }
  };

  changeButton.addEventListener("click", () => {
    void changePlan();
  });

  const changePlan = async (): Promise<void> => {
    const chosen = planRadios.find((radio) => radio.input.checked);
    if (!chosen || chosen.plan === currentPlan) {
      return;
    }
    pending = true;
    changeButton.disabled = true;
    for (const radio of planRadios) {
      radio.input.disabled = true;
    }
    announce(planStatus, planCopy.pending);
    const result = await request<Plan>("PUT", "/api/plan", { body: { plan: chosen.plan } });
    pending = false;
    changeButton.disabled = false;
    for (const radio of planRadios) {
      radio.input.disabled = false;
    }
    if (result.ok) {
      showPlan(result.data);
      announce(planStatus, planCopy.changed(result.data.label));
      return;
    }
    for (const radio of planRadios) {
      radio.input.checked = radio.plan === currentPlan;
    }
    changeButton.focus();
    if (result.code === "plan_too_small") {
      const definition = PLANS.find((candidate) => candidate.plan === chosen.plan);
      announce(
        planStatus,
        planCopy.tooSmall(
          definition?.label ?? chosen.plan,
          Number(result.body.quota_bytes ?? 0),
          Number(result.body.used_bytes ?? 0),
        ),
      );
      return;
    }
    announce(planStatus, planCopy.offline);
  };

  void showInitialView(root, Promise.all([loadMissions(), loadPlan(), loadStatus()]));
  setInterval(() => {
    void loadStatus();
    void loadPlan();
  }, STATUS_INTERVAL_MS);
}
