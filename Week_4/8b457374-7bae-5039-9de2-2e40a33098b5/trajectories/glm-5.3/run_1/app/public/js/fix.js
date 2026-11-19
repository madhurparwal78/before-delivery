import {
  apiFetch,
  formatCountdown,
  formatPence,
  mountHeader,
  startBannerRefresh
} from "./chunk-JDNZ7ISK.js";

// src/frontend/fix.ts
var code = window.location.pathname.replace(/^\/fix\//, "");
mountHeader("pledges");
startBannerRefresh();
var secondsLeft = 0;
async function load() {
  const { status, body } = await apiFetch(`/api/fix/${code}`);
  if (status !== 200) {
    window.location.href = "/404";
    return;
  }
  const view = body;
  const campaign = document.getElementById("fix-campaign");
  if (campaign !== null) campaign.textContent = view.campaign_title;
  const amount = document.getElementById("fix-amount");
  if (amount !== null) amount.textContent = formatPence(view.amount);
  secondsLeft = view.fix_seconds_left;
  tick();
}
function tick() {
  const countdown = document.getElementById("fix-countdown");
  if (countdown !== null) countdown.textContent = formatCountdown(secondsLeft);
  if (secondsLeft > 0) {
    secondsLeft -= 1;
    window.setTimeout(tick, 1e3);
  }
}
function announce(text) {
  const region = document.getElementById("fix-result");
  if (region !== null) region.textContent = text;
}
document.getElementById("fix-update")?.addEventListener("click", () => {
  void update();
});
document.getElementById("fix-card")?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    void update();
  }
});
async function update() {
  const cardField = document.getElementById("fix-card");
  const button = document.getElementById("fix-update");
  const error = document.getElementById("fix-field-error");
  const { body: before } = await apiFetch(`/api/fix/${code}`);
  const amount = before.amount;
  announce(`Asking the payment service to hold ${formatPence(amount)}.`);
  if (button !== null) button.disabled = true;
  const { status, body } = await apiFetch(`/api/fix/${code}`, {
    method: "POST",
    body: JSON.stringify({ card_number: cardField?.value ?? "" })
  });
  if (button !== null) button.disabled = false;
  if (status === 200) {
    announce(`Card updated. ${formatPence(amount)} is held and will be collected when the fix window closes.`);
    return;
  }
  const shape = body;
  if (shape.fields !== void 0) {
    if (error !== null) {
      error.textContent = shape.fields.card_number ?? "Use one of the test cards.";
      error.hidden = false;
    }
    cardField?.focus();
    return;
  }
  if (error !== null) error.hidden = true;
  switch (shape.error) {
    case "card_declined":
      announce("Card declined. No hold was placed. Try another card.");
      break;
    case "fix_window_closed":
      announce("The fix window has closed.");
      break;
    case "payment_unavailable":
      announce("Payment service unavailable. No hold was placed. Try again in a few minutes.");
      break;
    default:
      announce("Something went wrong. Try again.");
  }
}
void load();
window.setInterval(() => {
  void load();
}, 3e4);
