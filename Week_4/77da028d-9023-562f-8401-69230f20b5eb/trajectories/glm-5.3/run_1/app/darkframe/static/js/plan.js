/* The Plan screen: tonight decided by the server, the night time handle, the lens. */

import {
  api, announce, duration, longDate, paintVerdictCard,
  showFieldErrors, clearFieldErrors, statusText, owedText, openDialog, closeDialog,
  wireDialog, el, readKey,
} from "./app.js";
import { SkyChart } from "./chart.js";
import { SkyDome } from "./dome.js";

const params = new URLSearchParams(location.search);
let date = params.get("date") || null;
let minute = 0;
let nightMinutes = 0;
let plan = null;
let requestId = 0;
let dome = null;
let chart = null;
let lensCentre = null;
let lensPinned = false;
let reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function $(id) {
  return document.getElementById(id);
}

async function loadPlan(newMinute, announceText) {
  const id = ++requestId;
  const path = date ? `/api/plans/${date}?minute=${newMinute}` : "/api/tonight";
  try {
    const body = await api("GET", path);
    if (id !== requestId) return; // only the newest reply is painted
    plan = body;
    date = body.date;
    nightMinutes = body.night.minutes;
    minute = body.minute;
    await loadMask();
    document.querySelector('input[name="observing-date"]').value = body.date;
    paintAll();
    if (announceText) announce("plan-updates", announceText);
  } catch (err) {
    if (id === requestId) announce("plan-updates", err.message);
  }
}

async function loadMask() {
  try {
    const horizon = await api("GET", "/api/site/horizon");
    plan._mask = horizon.altitudes;
  } catch (err) {
    plan._mask = [];
  }
}

function requestPlan(announceText) {
  loadPlan(minute, announceText);
}

function paintAll() {
  paintHeadline();
  paintVerdictCard($("tonight-verdict"), plan);
  paintTargets();
  paintConditionsNotice();
  paintTimeBar();
  paintChart();
  paintDome();
}

function paintHeadline() {
  const h = document.querySelector(".plan-headline");
  if (h) h.textContent = `Night of ${longDate(plan.date)}`;
}

function paintTargets() {
  const list = $("plan-targets");
  list.textContent = "";
  (plan.targets || []).forEach((t) => {
    const li = el("li", { class: "target-item" + (t.position_status !== "clear" ? " dimmed" : "") });
    const name = el("span", { class: "t-name", text: t.target_name });
    const meta = el("span", {
      class: "t-meta",
      text: `${Math.round(t.altitude_deg)}° ${statusText(t.position_status)} · ${t.clear_minutes} clear min`,
    });
    const filters = el("span", {
      class: "t-filters num",
      text: t.filters.map((f) => `${f.filter} ${f.usable_minutes} min · owed ${duration(f.owed_after_tonight_seconds)}`).join("  ") || "No filters planned",
    });
    const remove = el("button", { class: "btn ghost", type: "button", "aria-label": `Remove ${t.target_name}`, text: "Remove" });
    remove.addEventListener("click", async () => {
      try {
        plan = await api("DELETE", `/api/plans/${date}/targets/${t.project_id}`);
        minute = 0;
        paintAll();
        announce("plan-updates", `${t.target_name} removed. At ${plan.time_local}: ${verdictWord(plan)}, ${usableOf(plan)} usable minutes left.`);
      } catch (err) {
        announce("plan-updates", err.message);
      }
    });
    li.append(name, remove, meta, filters);
    list.appendChild(li);
  });
}

function verdictWord(p) {
  return p.verdict === "go" ? "Go" : p.verdict === "no-go" ? "No-go" : "Unknown";
}

function usableOf(p) {
  return p.best ? p.best.usable_minutes : 0;
}

function paintConditionsNotice() {
  const region = $("conditions-notice");
  region.textContent = "";
  const notice = el("p", { class: "notice" });
  if (!plan.conditions || !plan.conditions.hours.length) {
    notice.textContent = "No sky conditions entered for this night. Add hourly cloud, transparency and seeing to get a verdict.";
    region.appendChild(notice);
  } else if (plan.conditions.stale) {
    notice.classList.add("stale");
    notice.textContent = "Sky conditions are out of date. Re-enter them for the hours still ahead.";
    region.appendChild(notice);
  }
}

function paintTimeBar() {
  const slider = $("night-time");
  slider.max = String(nightMinutes);
  slider.value = String(minute);
  const pct = nightMinutes ? (minute / nightMinutes) * 100 : 0;
  document.querySelectorAll(".time-fill").forEach((fill) => {
    fill.style.width = `${pct}%`;
  });
  document.querySelectorAll(".time-handle").forEach((handle) => {
    handle.style.left = `${pct}%`;
  });
  slider.setAttribute("aria-valuetext", `${plan.time_local} site time, minute ${minute}`);
  const readout = document.querySelector(".time-readout");
  if (readout) readout.textContent = `${plan.time_local} site time, minute ${minute}`;
  $("earlier-30").disabled = minute <= 0;
  $("later-30").disabled = minute >= nightMinutes;
}

function setMinute(newMinute, withAnnouncement = true) {
  const clamped = Math.max(0, Math.min(nightMinutes, newMinute));
  if (clamped === minute) return;
  minute = clamped;
  paintTimeBar();
  const handle = document.querySelector(".time-handle");
  if (handle && !reducedMotion) handle.classList.add("snapping");
  if (withAnnouncement) {
    requestPlan(null);
    loadPlan(minute, () => {});
    // The announcement is made once the server's reply arrives.
  } else {
    requestPlan(null);
  }
}

function stepHandle(delta) {
  const target = Math.max(0, Math.min(nightMinutes, minute + delta));
  setMinute(target);
  loadPlan(target, null);
}

async function loadPlanAndAnnounce() {
  const id = ++requestId;
  try {
    const body = await api("GET", date ? `/api/plans/${date}?minute=${minute}` : "/api/tonight");
    if (id !== requestId) return;
    plan = body;
    date = body.date;
    nightMinutes = body.night.minutes;
    minute = body.minute;
    paintAll();
    announce("plan-updates", `At ${plan.time_local}: ${verdictWord(plan)}, ${usableOf(plan)} usable minutes left.`);
  } catch (err) {
    if (id === requestId) announce("plan-updates", err.message);
  }
}

function wireTimeBar() {
  const slider = $("night-time");
  const handle = document.querySelector(".time-handle");

  slider.addEventListener("keydown", (event) => {
    const k = event.key;
    let delta = 0;
    if (k === "ArrowRight" || k === "ArrowUp") delta = 5;
    if (k === "ArrowLeft" || k === "ArrowDown") delta = -5;
    if (k === "PageUp" || ((k === "ArrowRight" || k === "ArrowUp") && event.shiftKey)) delta = 30;
    if (k === "PageDown" || ((k === "ArrowLeft" || k === "ArrowDown") && event.shiftKey)) delta = -30;
    if (k === "Home") { setMinute(0); event.preventDefault(); return; }
    if (k === "End") { setMinute(nightMinutes); event.preventDefault(); return; }
    if (delta) {
      event.preventDefault();
      stepHandle(delta);
    }
  });
  slider.addEventListener("input", () => {
    minute = Number(slider.value);
    paintTimeBar();
    handle.classList.add("snapping");
  });
  slider.addEventListener("change", () => {
    handle.classList.remove("snapping");
    loadPlanAndAnnounce();
  });

  const pick = (clientX, target) => {
    const rect = target.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Math.round(ratio * nightMinutes);
  };
  let dragging = false;
  const startDrag = (clientX, target) => {
    dragging = true;
    setMinute(pick(clientX, target), false);
  };
  const moveDrag = (clientX, target) => {
    if (!dragging) return;
    setMinute(pick(clientX, target), false);
  };
  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    const snapped = Math.round(minute / 5) * 5;
    setMinute(Math.max(0, Math.min(nightMinutes, snapped)), false);
    loadPlanAndAnnounce();
  };
  document.querySelectorAll(".time-bar").forEach((target) => {
    target.addEventListener("pointerdown", (event) => {
      target.setPointerCapture(event.pointerId);
      startDrag(event.clientX, target);
    });
    target.addEventListener("pointermove", (event) => moveDrag(event.clientX, target));
    target.addEventListener("pointerup", endDrag);
    target.addEventListener("pointercancel", endDrag);
  });

  $("earlier-30").addEventListener("click", () => stepHandle(-30));
  $("later-30").addEventListener("click", () => stepHandle(30));
}

function wireMinimumAltitude() {
  const input = $("min-altitude");
  input.value = String(plan.min_altitude_deg);
  input.addEventListener("change", async () => {
    const value = Number(input.value);
    try {
      await api("PATCH", "/api/site", { min_altitude_deg: value });
      await loadPlanAndAnnounce();
    } catch (err) {
      announce("plan-updates", err.message);
    }
  });
}

function wireAddTarget() {
  const dialog = $("add-target-dialog");
  wireDialog(dialog);
  const listbox = dialog.querySelector("select");
  $("add-target").addEventListener("click", async () => {
    listbox.textContent = "";
    try {
      const { projects } = await api("GET", "/api/projects");
      projects.filter((p) => p.state === "active").forEach((p) => {
        const option = el("option", { value: p.id, text: `${p.target_name} (${p.name})` });
        listbox.appendChild(option);
      });
    } catch (err) {
      /* the dialog still opens */
    }
    openDialog(dialog, $("add-target"));
  });
  dialog.querySelector("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const projectId = listbox.value;
    try {
      const body = await api("POST", `/api/plans/${date}/targets`, { project_id: projectId });
      plan = body;
      minute = 0;
      paintAll();
      closeDialog(dialog);
      const target = plan.targets.find((t) => t.project_id === projectId);
      announce("plan-updates", `${target ? target.target_name : "Target"} added. At ${plan.time_local}: ${verdictWord(plan)}, ${usableOf(plan)} usable minutes left.`);
    } catch (err) {
      announce("plan-updates", err.message);
    }
  });
}

function wireConditions() {
  const dialog = $("conditions-dialog");
  wireDialog(dialog);
  const form = dialog.querySelector("form");
  $("enter-conditions").addEventListener("click", () => {
    buildConditionsForm();
    openDialog(dialog, $("enter-conditions"));
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const hours = [];
    form.querySelectorAll(".hour-row").forEach((row) => {
      const hourStart = row.dataset.hourStart;
      const cloud = row.querySelector('[data-kind="cloud"]').value;
      const transparency = row.querySelector('[data-kind="transparency"]').value;
      const seeing = row.querySelector('[data-kind="seeing"]').value;
      if (cloud === "" || transparency === "" || seeing === "") return;
      hours.push({ hour_start: hourStart, cloud_pct: Number(cloud), transparency: Number(transparency), seeing: Number(seeing) });
    });
    announce("plan-updates", "Saving conditions...");
    try {
      const body = await api("PUT", `/api/plans/${date}/conditions`, { hours });
      plan = body;
      minute = 0;
      paintAll();
      closeDialog(dialog);
      announce("plan-updates", `Conditions saved for ${hours.length} hours.`);
    } catch (err) {
      if (err.fields) showFieldErrors("error-summary", err.fields);
      else announce("plan-updates", err.message);
    }
  });
}

function buildConditionsForm() {
  const host = $("conditions-hours");
  host.textContent = "";
  const hours = plan.hours || [];
  const saved = {};
  (plan.conditions && plan.conditions.hours ? plan.conditions.hours : []).forEach((h) => {
    saved[h.hour_start] = h;
  });
  hours.forEach((iso, index) => {
    const label = displayHourLabel(iso, index, hours);
    const previous = saved[iso] || {};
    const row = el("div", { class: "hour-row field-row", "data-hour-start": iso });
    row.appendChild(el("label", { text: label, for: `cloud-${index}` }));
    const cloud = el("input", { type: "number", id: `cloud-${index}`, name: `cloud-${index}`, "data-kind": "cloud", min: "0", max: "100", step: "1", value: previous.cloud_pct === undefined ? "" : String(previous.cloud_pct) });
    cloud.setAttribute("aria-label", `Cloud ${label}`);
    const transparency = el("input", { type: "number", id: `transparency-${index}`, name: `transparency-${index}`, "data-kind": "transparency", min: "1", max: "5", step: "1", value: previous.transparency === undefined ? "" : String(previous.transparency) });
    transparency.setAttribute("aria-label", `Transparency ${label}`);
    const seeing = el("input", { type: "number", id: `seeing-${index}`, name: `seeing-${index}`, "data-kind": "seeing", min: "1", max: "5", step: "1", value: previous.seeing === undefined ? "" : String(previous.seeing) });
    seeing.setAttribute("aria-label", `Seeing ${label}`);
    row.append(cloud, transparency, seeing);
    host.appendChild(row);
  });
}

/* A repeated local hour shows its UTC offset, for example 01:00 (+01:00). */
function displayHourLabel(iso, index, hours) {
  const plain = iso.slice(11, 16);
  const offset = iso.slice(-6, -3) + ":" + iso.slice(-2);
  const repeats = new Set(hours.map((h) => h.slice(11, 16))).size !== hours.length;
  return repeats ? `${plain} (${offset})` : plain;
}

function wireChartAndLens() {
  const canvas = $("sky-chart");
  chart = new SkyChart(canvas, 520);
  const lens = document.querySelector(".lens");
  const lensCanvas = lens.querySelector("canvas");
  const readout = $("lens-readout");

  canvas.addEventListener("pointermove", (event) => {
    if (reducedMotion) return;
    const rect = canvas.getBoundingClientRect();
    lensCentre = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    showLens(lens, lensCanvas, readout);
  });
  canvas.addEventListener("pointerleave", () => {
    if (!lensPinned) lens.hidden = true;
  });
  canvas.addEventListener("click", (event) => {
    const rect = canvas.getBoundingClientRect();
    lensCentre = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    lensPinned = true;
    showLens(lens, lensCanvas, readout);
  });
}

function showLens(lens, lensCanvas, readout) {
  if (!lensCentre || !plan) return;
  const rectSize = chart.size;
  const centre = { x: (lensCentre.x / rectSize) * 320, y: (lensCentre.y / rectSize) * 320 };
  lens.hidden = false;
  lens.style.left = `${lensCentre.x}px`;
  lens.style.top = `${lensCentre.y}px`;
  chart.paintLens(lensCanvas, centre, plan);
  const nearest = nearestTarget(lensCentre);
  if (nearest) {
    const behind = nearest.position_status === "behind-treeline" ? ", behind the treeline" : "";
    readout.textContent = `${nearest.target_name}: altitude ${nearest.altitude_deg.toFixed(1)} degrees, Moon ${nearest.moon_separation_deg.toFixed(1)} degrees away${behind}`;
  } else {
    readout.textContent = "No target under the lens";
  }
}

function nearestTarget(point) {
  const px = (point.x / chart.size) * chart.size;
  let best = null;
  let bestDist = 80;
  (plan.targets || []).forEach((t) => {
    const pos = chart.project(t.altitude_deg, t.azimuth_deg, chart.size / 2 * chart.dpr, chart.size * 0.44 * chart.dpr);
    const d = Math.hypot(pos.x / chart.dpr - point.x, pos.y / chart.dpr - point.y);
    if (d < bestDist) {
      bestDist = d;
      best = t;
    }
  });
  return best;
}

function paintChart() {
  if (!chart) chart = new SkyChart($("sky-chart"), 520);
  chart.paint(plan);
}

function paintDome() {
  const holder = $("dome-holder");
  const name = dome ? dome.name(minute) : `Sky dome: camera elevation 35 degrees, azimuth 180 degrees, zoom 1.0, night minute ${minute}`;
  const img = document.querySelector('[role="img"][data-dome-name]');
  if (img) img.setAttribute("aria-label", name);
  if (dome && dome.ok) {
    dome.setPlan(plan);
  } else {
    // The still chart fallback, identical figures.
    const fallback = document.querySelector(".dome-fallback");
    if (fallback) {
      const canvas = fallback.querySelector("canvas");
      if (canvas) {
        const c = new SkyChart(canvas, 520);
        c.paint(plan);
      }
    }
  }
}

function wireDome() {
  const canvas = $("sky-dome");
  dome = new SkyDome(canvas, 520);
  dome.init().then((ok) => {
    if (!ok) showDomeFallback();
    else if (plan) dome.setPlan(plan);
    const img = document.querySelector('[data-dome-name]');
    if (img) img.setAttribute("aria-label", dome.name(minute));
  });
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  const start = (x, y) => {
    dragging = true;
    lastX = x;
    lastY = y;
  };
  const move = (x, y) => {
    if (!dragging || !dome || !dome.ok) return;
    const dx = x - lastX;
    const dy = y - lastY;
    lastX = x;
    lastY = y;
    dome.orbit((dx / 100) * 25, -(dy / 100) * 25);
    updateDomeName();
  };
  const end = () => {
    dragging = false;
  };
  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    start(e.clientX, e.clientY);
  });
  canvas.addEventListener("pointermove", (e) => move(e.clientX, e.clientY));
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
  canvas.addEventListener("wheel", (e) => {
    if (!dome || !dome.ok) return;
    e.preventDefault();
    dome.zoomBy(e.deltaY < 0 ? 0.1 : -0.1);
    updateDomeName();
  }, { passive: false });
  canvas.addEventListener("dblclick", () => {
    if (!dome || !dome.ok) return;
    dome.reset();
    updateDomeName();
  });
  canvas.addEventListener("keydown", (e) => {
    if (!dome || !dome.ok) return;
    const k = e.key;
    if (k === "ArrowRight") dome.orbit(5, 0);
    else if (k === "ArrowLeft") dome.orbit(-5, 0);
    else if (k === "ArrowUp") dome.orbit(0, 5);
    else if (k === "ArrowDown") dome.orbit(0, -5);
    else if (k === "+" || k === "=") dome.zoomBy(0.1);
    else if (k === "-") dome.zoomBy(-0.1);
    else if (k === "0") dome.reset();
    else return;
    e.preventDefault();
    updateDomeName();
  });
}

function updateDomeName() {
  const img = document.querySelector('[data-dome-name]');
  if (img && dome) img.setAttribute("aria-label", dome.name(minute));
}

function showDomeFallback() {
  const host = document.querySelector(".plan-stage");
  if (!host || document.querySelector(".dome-fallback")) return;
  const canvas = $("sky-dome");
  canvas.hidden = true;
  const wrap = el("div", { class: "dome-fallback", role: "img", "data-dome-name": "1", tabindex: "0" });
  const inner = el("canvas");
  wrap.appendChild(inner);
  const text = el("p", { class: "notice", text: "3D sky is unavailable on this device. Showing the flat sky chart." });
  host.append(wrap, text);
  if (plan) {
    const c = new SkyChart(inner, 520);
    c.paint(plan);
  }
  wrap.setAttribute("aria-label", `Sky dome: camera elevation 35 degrees, azimuth 180 degrees, zoom 1.0, night minute ${minute}`);
  wrap.addEventListener("keydown", (e) => {
    if (["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown", "+", "-", "0"].includes(e.key)) e.preventDefault();
  });
}

function wireDate() {
  const input = document.querySelector('input[name="observing-date"]');
  const tonightBtn = $("tonight-button");
  input.addEventListener("change", () => {
    const value = input.value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      date = value;
      minute = 0;
      loadPlan(0, null);
    }
  });
  tonightBtn.addEventListener("click", () => {
    date = null;
    minute = 0;
    loadPlan(0, null);
  });
}

function wireShortcuts() {
  document.addEventListener("keydown", (event) => {
    const tag = document.activeElement ? document.activeElement.tagName : "";
    const isText = tag === "INPUT" && !["button", "checkbox"].includes(document.activeElement.type) || tag === "TEXTAREA" || tag === "SELECT";
    if (isText) return;
    if (document.querySelector("dialog[open]")) return;
    if (event.key === "[") {
      event.preventDefault();
      stepHandle(-5);
    } else if (event.key === "]") {
      event.preventDefault();
      stepHandle(5);
    } else if (event.key === "a" || event.key === "A") {
      event.preventDefault();
      $("add-target").click();
    }
  });
}

async function boot() {
  readKey();
  wireTimeBar();
  wireAddTarget();
  wireConditions();
  wireChartAndLens();
  wireDome();
  wireDate();
  wireShortcuts();
  await loadPlan(0, null);
  wireMinimumAltitude();
  // Refresh the latest plan request every 60 seconds without touching the handle.
  setInterval(() => {
    loadPlan(minute, null);
  }, 55_000);
}

boot();
