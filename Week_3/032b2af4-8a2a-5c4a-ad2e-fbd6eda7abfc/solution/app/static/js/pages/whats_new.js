import { $, $$ } from "../core/dom.js";

const input = $("#story-q");
const cards = $$("[data-title]");

input.addEventListener("input", () => {
  const query = input.value.trim().toLowerCase();
  for (const card of cards) card.hidden = !card.dataset.title.toLowerCase().includes(query);
});
