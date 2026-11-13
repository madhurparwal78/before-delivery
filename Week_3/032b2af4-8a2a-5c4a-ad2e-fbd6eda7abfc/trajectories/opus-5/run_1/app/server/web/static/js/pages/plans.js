import { api, token } from "../api.js";

function billingToggle() {
  const card = document.querySelector("[data-individual-card]");
  if (!card) return;
  const price = card.querySelector("[data-individual-price]");
  const note = card.querySelector("[data-individual-note]");
  const period = card.querySelector("[data-individual-period]");
  card.querySelectorAll("[data-billing]").forEach((button) =>
    button.addEventListener("click", () => {
      const annual = button.dataset.billing === "annual";
      card.querySelectorAll("[data-billing]").forEach((other) =>
        other.setAttribute("aria-pressed", String(other === button))
      );
      price.textContent = annual ? "$6.67" : "$11.99";
      period.textContent = "/month";
      note.textContent = annual ? "Billed at $79.99/year." : "Billed monthly.";
    })
  );
}

function trials() {
  document.querySelectorAll("[data-start-trial]").forEach((button) =>
    button.addEventListener("click", async () => {
      const status = button.closest("section").querySelector("[data-trial-status]");
      if (!token()) {
        if (status) status.textContent = "Log in or sign up to start your free trial.";
        window.location.href = "/login";
        return;
      }
      const card = button.closest("[data-individual-card]");
      const monthly = card && card.querySelector('[data-billing="monthly"][aria-pressed="true"]');
      const { ok, data } = await api("/api/subscription", {
        method: "POST",
        body: { plan: button.dataset.plan, billing: monthly ? "monthly" : "annual" },
      });
      if (status) {
        status.textContent = ok
          ? `Your ${data.plan} trial has started and ends on ${data.trial_ends_on}.`
          : "That plan could not be started.";
      }
    })
  );
}

export function init() {
  billingToggle();
  trials();
}
