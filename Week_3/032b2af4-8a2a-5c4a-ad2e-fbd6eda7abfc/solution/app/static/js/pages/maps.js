import { api, currentAthlete } from "../core/api.js";
import { $, $$, h, notice, s } from "../core/dom.js";
import { km } from "../core/format.js";
import { fitProjection, mapGround } from "../components/route-map.js";

const WIDTH = 1200;
const HEIGHT = 800;
const canvas = $("[data-map-canvas]");
const list = $("[data-segment-list]");
const panel = $("[data-segment-panel]");
const search = $("[data-map-search]");
const message = $("[data-map-message]");
const heat = $("[data-heatmaps]");

let me = null;
let segments = [];
let sport = "all";
let selected = null;
let heatLines = [];

const grade = (segment) => `${((segment.elevation_diff_m / segment.distance_m) * 100).toFixed(1)}%`;

function visible() {
  const query = search.value.trim().toLowerCase();
  return segments.filter((seg) => seg.name.toLowerCase().includes(query) && (sport === "all" || seg.sport_types.includes(sport)));
}

function draw() {
  const everything = visible();
  const anchor = selected && everything.includes(selected) ? selected : everything[0];
  const near = (seg) => Math.abs(seg.start_lat - anchor.start_lat) < 0.5 && Math.abs(seg.start_lon - anchor.start_lon) < 0.5;
  const shown = everything.filter(near);
  const focus = selected && shown.includes(selected) ? [selected] : shown;
  const points = [...focus.flatMap((seg) => [[seg.start_lat, seg.start_lon], [seg.end_lat, seg.end_lon]]),
    ...(heat.getAttribute("aria-pressed") === "true" ? heatLines.flat() : [])];
  canvas.setAttribute("viewBox", `0 0 ${WIDTH} ${HEIGHT}`);
  canvas.setAttribute("preserveAspectRatio", "xMidYMid slice");
  canvas.replaceChildren(mapGround("pacely", WIDTH, HEIGHT, "explorer"));
  if (!everything.length && !heatLines.length) return;
  if (!points.length) return;
  const left = innerWidth >= 900 ? 440 : 40;
  const project = fitProjection(points.length < 2 ? [...points, points[0]] : points, WIDTH, HEIGHT, 90);
  const place = (lat, lon) => {
    const [x, y] = project(lat, lon);
    return [left + (x / WIDTH) * (WIDTH - left - 60), y];
  };
  if (heat.getAttribute("aria-pressed") === "true") {
    for (const line of heatLines) {
      canvas.append(s("path", { d: line.map((p, i) => `${i ? "L" : "M"}${place(p[0], p[1]).map((n) => n.toFixed(1)).join(" ")}`).join(""), fill: "none", stroke: "#D93D00", "stroke-width": 4, opacity: "0.35", "stroke-linecap": "round", "stroke-linejoin": "round" }));
    }
  }
  for (const seg of shown) {
    const a = place(seg.start_lat, seg.start_lon), b = place(seg.end_lat, seg.end_lon);
    const active = seg === selected;
    const d = `M${a.map((n) => n.toFixed(1)).join(" ")}L${b.map((n) => n.toFixed(1)).join(" ")}`;
    canvas.append(s("path", { d, fill: "none", stroke: "#fff", "stroke-width": active ? 14 : 10, "stroke-linecap": "round" }));
    canvas.append(s("path", { d, fill: "none", stroke: "#D93D00", "stroke-width": active ? 7 : 5, "stroke-linecap": "round" }));
    canvas.append(s("circle", { cx: a[0], cy: a[1], r: 8, fill: "#4A6B00", stroke: "#fff", "stroke-width": 3 }));
    if (active) canvas.append(s("circle", { class: "blink", cx: a[0], cy: a[1], r: 18, fill: "none", stroke: "#D93D00", "stroke-width": 3 }));
  }
}

function renderList() {
  const shown = visible();
  list.replaceChildren(...shown.map((seg) => h("li", {}, h("button", { type: "button", "aria-current": String(seg === selected), onclick: () => choose(seg) },
    h("span", { text: seg.name }), h("span", { class: "small muted", text: `${km(seg.distance_m)} km` })))));
  if (me && !shown.length) list.replaceChildren(h("li", { class: "small muted", text: "No segments match." }));
}

function choose(seg) {
  selected = seg;
  $("[data-panel-name]").textContent = seg.name;
  $("[data-panel-distance]").textContent = `${km(seg.distance_m)} km`;
  $("[data-panel-grade]").textContent = grade(seg);
  $("[data-panel-link]").href = `/segments/${seg.id}`;
  panel.hidden = false;
  renderList();
  draw();
}

function refresh() {
  if (selected && !visible().includes(selected)) {
    selected = null;
    panel.hidden = true;
  }
  renderList();
  draw();
}

search.addEventListener("input", refresh);
for (const button of $$("[data-sport]")) {
  button.addEventListener("click", () => {
    sport = button.dataset.sport;
    for (const other of $$("[data-sport]")) other.setAttribute("aria-pressed", String(other === button));
    refresh();
  });
}
$("[data-panel-close]").addEventListener("click", () => {
  selected = null;
  panel.hidden = true;
  refresh();
});
$("[data-create-route]").addEventListener("click", () => {
  message.replaceChildren(notice("info", "Route building is coming soon."));
});
heat.addEventListener("click", async () => {
  const on = heat.getAttribute("aria-pressed") !== "true";
  if (on && !me) {
    message.replaceChildren(notice("info", "Log in to draw your own activity lines."));
    return;
  }
  if (on && !heatLines.length) {
    const result = await api(`/api/athletes/${me.id}/activities?limit=50`);
    heatLines = result.ok ? result.data.activities.map((a) => a.route).filter((r) => r.length > 1) : [];
  }
  heat.setAttribute("aria-pressed", String(on));
  message.replaceChildren();
  draw();
});

draw();
currentAthlete().then(async (athlete) => {
  me = athlete;
  if (!me) return;
  $("[data-map-hint]").textContent = "Choose a segment to see its distance and grade.";
  const result = await api("/api/segments");
  segments = result.ok ? result.data.segments : [];
  refresh();
});
