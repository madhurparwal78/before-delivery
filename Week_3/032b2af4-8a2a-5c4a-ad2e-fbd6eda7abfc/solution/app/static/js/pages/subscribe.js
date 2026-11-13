import { api, currentAthlete } from "../core/api.js";
import { $, $$, notice } from "../core/dom.js";
import { toast } from "../core/toast.js";

let billing = "annual";

for (const button of $$("[data-billing]")) {
  button.addEventListener("click", () => {
    billing = button.dataset.billing;
    for (const other of $$("[data-billing]")) other.setAttribute("aria-pressed", String(other === button));
    for (const price of $$("[data-price]")) price.hidden = price.dataset.price !== billing;
  });
}

async function choose(plan, selectedBilling) {
  const me = await currentAthlete();
  if (!me) {
    location.assign("/signup?next=/subscribe");
    return;
  }
  const result = await api("/api/subscription", { method: "POST", body: { plan, billing: selectedBilling } });
  const slot = $("[data-trial-note]");
  if (result.ok) {
    slot.replaceChildren();
    toast(`Your 30-day trial of the ${plan} plan has started and ends on ${result.data.trial_ends_on}.`);
  } else {
    slot.replaceChildren(notice("error", "The trial could not be started. Please try again."));
  }
}

for (const button of $$("[data-choose]")) {
  button.addEventListener("click", () => choose(button.dataset.choose, button.dataset.choose === "individual" ? billing : "annual"));
}
for (const button of $$("[data-start-trial]")) button.addEventListener("click", () => choose("individual", billing));
