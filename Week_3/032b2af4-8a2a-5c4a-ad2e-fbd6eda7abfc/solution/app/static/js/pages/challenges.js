import { api, currentAthlete } from "../core/api.js";
import { $, $$, h, s, icon } from "../core/dom.js";
import { duration, shortDate, thousands } from "../core/format.js";
import { toast } from "../core/toast.js";

const SPORTS = ["run", "ride", "swim", "walk", "hike", "workout"];
const MEASURES = { distance: ["distance", "single_distance"], "elevation-gain": ["elevation"], "moving-time": ["moving_time"] };
const chips = $$("[data-chip]");
const cards = $$(".gallery [data-challenge]");
let me = null;

/* ---------- filter chips: the chosen chip lives in the address as ?filter= ---------- */
const currentFilter = () => new URLSearchParams(location.search).get("filter");

function matches(card, filter) {
  if (!filter) return true;
  if (SPORTS.includes(filter)) return card.dataset.sports.split(" ").includes(filter);
  return (MEASURES[filter] || []).includes(card.dataset.dimension);
}

function applyFilter() {
  const filter = currentFilter();
  for (const chip of chips) chip.setAttribute("aria-pressed", String(chip.dataset.chip === filter));
  for (const card of cards) card.hidden = !matches(card, filter);
  for (const gallery of $$("[data-gallery]")) {
    $("[data-empty]", gallery).hidden = $$("[data-challenge]", gallery).some((card) => !card.hidden);
  }
}

for (const chip of chips) {
  chip.addEventListener("click", () => {
    const url = new URL(location.href);
    if (chip.getAttribute("aria-pressed") === "true") url.searchParams.delete("filter");
    else url.searchParams.set("filter", chip.dataset.chip);
    history.pushState({}, "", url);
    applyFilter();
  });
}
addEventListener("popstate", applyFilter);
applyFilter();

/* ---------- joined state: progress rings and the join control ---------- */
function progressText(c) {
  if (c.dimension === "elevation") return `${thousands(c.progress)} of ${thousands(c.goal)} m`;
  if (c.dimension === "moving_time") return `${duration(c.progress)} of ${duration(c.goal)}`;
  return `${(c.progress / 1000).toFixed(1)} of ${thousands(c.goal / 1000)} km`;
}

function ring(c) {
  const percent = Math.min(100, Math.floor((c.progress * 100) / c.goal));
  const circumference = 2 * Math.PI * 28;
  const svg = s("svg", { class: "ring-svg", viewBox: "0 0 64 64", "aria-hidden": "true", focusable: "false" },
    s("circle", { class: "ring-track", cx: 32, cy: 32, r: 28 }),
    s("circle", { class: "ring-value", cx: 32, cy: 32, r: 28, "stroke-dasharray": `${(circumference * percent) / 100} ${circumference}` }));
  return h("div", { class: "ring", role: "progressbar", "aria-label": c.name, "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(percent) },
    svg,
    h("div", { class: "ring-text" }, h("span", { text: `${percent}%` }), h("span", { class: "small muted", text: progressText(c) }),
      c.completed ? h("span", { class: "done" }, icon("check"), "Completed") : null));
}

function paint(list) {
  for (const c of list) {
    for (const card of $$(`[data-challenge="${c.id}"]`)) {
      const promoted = card.hasAttribute("data-promoted");
      const slot = $("[data-ring]", card);
      slot.replaceChildren(...(c.joined ? [ring(c)] : []));
      const button = $("[data-join]", card);
      button.textContent = `${c.joined ? "Leave" : "Join"} ${promoted ? "Challenge" : c.name}`;
      if (!promoted) button.setAttribute("aria-label", `${c.joined ? "Leave" : "Join"} ${c.name}`);
      button.dataset.joined = String(c.joined);
      if (promoted) {
        $("[data-range]", card).textContent = `${shortDate(c.starts_at, me.time_zone)} to ${shortDate(new Date(Date.parse(c.ends_at) - 1000).toISOString(), me.time_zone)}`;
      }
    }
  }
}

async function refresh() {
  const result = await api("/api/challenges");
  if (result.ok) paint(result.data.challenges);
}

for (const card of $$("[data-challenge]")) {
  $("[data-join]", card).addEventListener("click", async (event) => {
    if (!me) {
      location.assign("/login?next=/challenges");
      return;
    }
    const joined = event.currentTarget.dataset.joined === "true";
    const result = await api(`/api/challenges/${card.dataset.challenge}/join`, { method: joined ? "DELETE" : "POST" });
    if (result.ok) {
      toast(`${joined ? "You left" : "You joined"} ${card.dataset.name}.`);
      await refresh();
    } else {
      toast("That could not be saved. Please try again.");
    }
  });
}

currentAthlete().then(async (athlete) => {
  me = athlete;
  if (me) await refresh();
});
