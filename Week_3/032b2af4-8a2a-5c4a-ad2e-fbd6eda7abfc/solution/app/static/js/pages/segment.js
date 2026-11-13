import { api, requireMember } from "../core/api.js";
import { $, h, icon, notice } from "../core/dom.js";
import { km, mmss, shortDate, thousands } from "../core/format.js";
import { routeMap } from "../components/route-map.js";
import { emptyState } from "../components/cards.js";

const root = $("[data-segment-root]");
const id = location.pathname.split("/").pop();
let me = null;
let segment = null;
let tab = "overall";
const host = h("div", { class: "card board-card" });

const filterFromUrl = () => (new URLSearchParams(location.search).get("filter") === "following" ? "following" : "overall");

function notFound() {
  root.replaceChildren(h("div", { class: "empty-state" }, h("strong", { text: "Segment not found" }),
    h("a", { class: "btn btn-primary btn-pill", href: "/dashboard", text: "Back to the dashboard" })));
}

function tabs() {
  const make = (key, label) => h("button", { role: "tab", id: `tab-${key}`, type: "button", "aria-selected": String(tab === key), tabindex: tab === key ? "0" : "-1", text: label,
    onclick: () => choose(key, true), onkeydown: (event) => {
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        choose(key === "overall" ? "following" : "overall", true, true);
      }
    } });
  return h("div", { class: "tablist", role: "tablist", "aria-label": "Leaderboard" }, make("overall", "Overall"), make("following", "Following"));
}

function table(board) {
  const rows = board.entries.map((entry) => h("tr", { class: entry.athlete_id === me.id ? "is-viewer" : null },
    h("th", { scope: "row", text: String(entry.rank) }),
    h("td", {}, entry.rank === 1 ? icon("crown", "crown", "First place") : null, entry.rank === 1 ? " " : null, h("a", { href: `/athletes/${entry.athlete_id}`, text: entry.athlete_name })),
    h("td", { class: "num", text: mmss(entry.elapsed_time_s) }),
    h("td", { text: shortDate(entry.start_time, me.time_zone) })));
  return h("div", { class: "table-frame", tabindex: "0", role: "region", "aria-label": "Leaderboard" },
    h("table", { class: "data-table" }, h("caption", { class: "sr-only", text: "Leaderboard" }),
      h("thead", {}, h("tr", {}, h("th", { scope: "col", text: "Rank" }), h("th", { scope: "col", text: "Athlete" }), h("th", { scope: "col", class: "num", text: "Time" }), h("th", { scope: "col", text: "Date" }))),
      h("tbody", {}, ...rows)));
}

function notes(board) {
  const out = [];
  const mine = board.viewer_entry;
  if (mine && !board.entries.some((entry) => entry.athlete_id === me.id)) {
    out.push(h("p", { class: "is-viewer notice" }, icon("pin"), h("span", {}, h("strong", { text: "Your result: " }), `rank ${mine.rank}, ${mmss(mine.elapsed_time_s)} on ${shortDate(mine.start_time, me.time_zone)}`)));
  }
  if (board.entry_count > board.entries.length) {
    out.push(h("p", { class: "muted" }, `Showing the first ${board.entries.length} of ${board.entry_count} entries. `, h("a", { href: "/subscribe", text: "Subscribe to see every entry." })));
  }
  return out.length ? h("div", { class: "board-note" }, ...out) : null;
}

async function load() {
  host.setAttribute("aria-busy", "true");
  const query = tab === "following" ? "?filter=following" : "";
  const result = await api(`/api/segments/${id}/leaderboard${query}`);
  host.removeAttribute("aria-busy");
  if (!result.ok) {
    host.replaceChildren(tabs(), h("div", { class: "board-note" }, notice("error", "The leaderboard could not be loaded.")));
    return;
  }
  const board = result.data;
  host.replaceChildren(tabs(),
    board.entries.length ? table(board) : h("div", { class: "board-note" }, emptyState(tab === "following" ? "Nobody you follow has run this yet" : "No efforts yet", "Efforts appear here as athletes pass through the segment.")),
    ...[notes(board)].filter(Boolean));
}

function choose(key, push, focus = false) {
  tab = key;
  if (push) {
    const url = new URL(location.href);
    if (key === "following") url.searchParams.set("filter", "following");
    else url.searchParams.delete("filter");
    history.pushState({}, "", url);
  }
  load().then(() => focus && $(`#tab-${key}`, host)?.focus());
}

function renameDialog() {
  const input = h("input", { class: "input", id: "rename-input", type: "text", maxlength: "60", value: segment.name });
  const errors = h("div", {});
  const form = h("form", { class: "stack", method: "dialog", novalidate: true },
    h("div", { class: "field" }, h("label", { for: "rename-input", text: "Segment name" }), input), errors,
    h("div", { class: "dialog-actions" }, h("button", { class: "btn btn-outline btn-pill", type: "button", text: "Cancel", onclick: () => dialog.close() }),
      h("button", { class: "btn btn-primary btn-pill", type: "submit", text: "Save name" })));
  const dialog = h("dialog", { "aria-label": "Rename segment" }, h("div", { class: "dialog-body" }, h("h2", { class: "card-title", text: "Rename segment" }), form));
  dialog.addEventListener("close", () => dialog.remove());
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const result = await api(`/api/segments/${segment.id}`, { method: "PATCH", body: { name: input.value } });
    if (result.ok) {
      segment = result.data;
      $("h1", root).textContent = segment.name;
      document.title = `${segment.name} | Pacely`;
      dialog.close();
    } else {
      errors.replaceChildren(notice("error", "Use a name of 3 to 60 characters."));
    }
  });
  document.body.append(dialog);
  dialog.showModal();
}

function render() {
  const grade = ((segment.elevation_diff_m / segment.distance_m) * 100).toFixed(1);
  const art = routeMap([[segment.start_lat, segment.start_lon], [segment.end_lat, segment.end_lon]], { width: 360, height: 160, compact: true, label: `Route of ${segment.name}`, seed: String(segment.id), id: "segment" }).svg;
  root.replaceChildren(
    h("div", { class: "segment-head" },
      h("p", { class: "kicker", text: "Segment" }),
      h("h1", { text: segment.name }),
      h("dl", { class: "segment-facts" },
        h("div", {}, h("dt", { text: "Distance" }), h("dd", { text: `${km(segment.distance_m)} km` })),
        h("div", {}, h("dt", { text: "Elevation difference" }), h("dd", { text: `${thousands(segment.elevation_diff_m)} m` })),
        h("div", {}, h("dt", { text: "Average grade" }), h("dd", { text: `${grade}%` }))),
      segment.creator_id === me.id ? h("div", {}, h("button", { class: "btn btn-outline btn-pill", type: "button", text: "Rename segment", onclick: renameDialog })) : null),
    h("div", { class: "profile-grid" }, h("div", { class: "card", style: "padding:0;overflow:hidden" }, art), host));
}

requireMember().then(async (athlete) => {
  me = athlete;
  if (!/^\d{1,18}$/.test(id)) return notFound();
  const result = await api(`/api/segments/${id}`);
  if (!result.ok) return notFound();
  segment = result.data;
  document.title = `${segment.name} | Pacely`;
  tab = filterFromUrl();
  render();
  await load();
  addEventListener("popstate", () => choose(filterFromUrl(), false));
  return null;
});
