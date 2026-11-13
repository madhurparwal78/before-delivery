import { thousands } from "../format.js";

function unitPrice(members) {
  if (members <= 24) return 71.99;
  if (members <= 99) return 63.99;
  return 55.99;
}

export function init() {
  const range = document.querySelector("[data-team-range]");
  const count = document.querySelector("[data-team-count]");
  const unit = document.querySelector("[data-team-unit]");
  const total = document.querySelector("[data-team-total]");
  if (!range || !count) return;

  const show = (members) => {
    const price = unitPrice(members);
    unit.textContent = `$${price.toFixed(2)} per year`;
    total.textContent = `$${thousands(members * price, 2)}`;
  };

  const apply = (value) => {
    const members = Math.min(250, Math.max(2, Number(value) || 2));
    range.value = String(members);
    count.value = String(members);
    show(members);
  };

  range.addEventListener("input", () => apply(range.value));
  count.addEventListener("input", () => apply(count.value));
  apply(range.value);
}
