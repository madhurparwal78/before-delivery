import { $ } from "../core/dom.js";

const TIERS = [[24, 7199], [99, 6399], [250, 5599]];
const MIN = 2;
const MAX = 250;

const number = $("#members-number");
const range = $("[data-members-range]");

const money = (cents) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const clamp = (value) => Math.min(MAX, Math.max(MIN, Math.round(value) || MIN));

function update(members) {
  const each = TIERS.find(([upTo]) => members <= upTo)[1];
  $("[data-each]").textContent = money(each);
  $("[data-total]").textContent = money(each * members);
}

number.addEventListener("input", () => {
  const typed = Number(number.value);
  if (number.value !== "" && typed >= MIN && typed <= MAX) {
    range.value = typed;
    update(Math.round(typed));
  }
});
number.addEventListener("change", () => {
  const members = clamp(Number(number.value));
  number.value = members;
  range.value = members;
  update(members);
});
range.addEventListener("input", () => {
  number.value = range.value;
  update(Number(range.value));
});
