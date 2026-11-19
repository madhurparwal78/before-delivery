/* The Site screen: form, horizon painter, reminders, push log. */

import {
  api, announce, paintVerdictCard, el, showFieldErrors, startTonightRefresh,
  readKey,
} from "./app.js";

const $ = (id) => document.getElementById(id);
let mask = [];
let selectedBin = 0;
let painter = null;
let saveTimer = null;

async function boot() {
  readKey();
  import("/static/js/chrome.js").then(({ wireLockButton }) => wireLockButton());
  refreshTonight();
  startTonightRefresh(refreshTonight);
  await Promise.all([loadSite(), loadHorizon(), loadReminders(), loadPushes()]);
  wireSiteForm();
  wirePainter();
  wireReminder();
}

async function refreshTonight() {
  try {
    const plan = await api("GET", "/api/tonight");
    paintVerdictCard($("tonight-verdict"), plan);
  } catch (err) {
    /* keep the last figures */
  }
}

async function loadSite() {
  const site = await api("GET", "/api/site");
  $("site-label").value = site.label;
  $("site-latitude").value = String(site.latitude);
  $("site-longitude").value = String(site.longitude);
  $("site-elevation").value = String(site.elevation_m);
  $("push-topic").value = site.push_topic || "";
  const select = $("site-zone");
  ["Europe/London", "Europe/Madrid", "Europe/Paris", "Europe/Berlin", "UTC", "America/New_York", "America/Los_Angeles", "Asia/Tokyo", "Australia/Sydney"].forEach((z) => {
    select.appendChild(el("option", { value: z, text: z }));
  });
  select.value = site.time_zone;
}

async function loadHorizon() {
  const body = await api("GET", "/api/site/horizon");
  mask = body.altitudes;
  selectedBin = 0;
  paintPainter();
}

async function loadReminders() {
  const body = await api("GET", "/api/reminders/new-moon");
  $("reminder-enabled").checked = body.enabled;
  $("reminder-time").value = body.local_time;
  const list = $("upcoming-reminders");
  list.textContent = "";
  body.upcoming.forEach((o) => {
    const date = o.remind_local.slice(0, 10);
    const time = o.remind_local.slice(11, 16);
    const nmDate = o.new_moon_local_date;
    list.appendChild(el("li", { text: `${date} ${time} before the new moon of ${nmDate}` }));
  });
}

async function loadPushes() {
  try {
    const body = await api("GET", "/api/pushes");
    $("push-unavailable").hidden = true;
    const tbody = $("push-tbody");
    tbody.textContent = "";
    body.pushes.forEach((p) => {
      const tr = el("tr");
      tr.append(
        el("td", { text: p.title }),
        el("td", { text: p.status === "unsent" ? "Push not sent yet. Darkframe will retry." : p.status }),
        el("td", { class: "num", text: String(p.attempts) }),
        el("td", { class: "num", text: p.sent_at ? p.sent_at.replace("T", " ").slice(0, 16) : "" })
      );
      tbody.appendChild(tr);
    });
  } catch (err) {
    $("push-unavailable").hidden = false;
  }
}

function wireSiteForm() {
  $("site-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    announce("site-updates", "Saving site...");
    try {
      await api("PATCH", "/api/site", {
        label: $("site-label").value.trim(),
        latitude: Number($("site-latitude").value),
        longitude: Number($("site-longitude").value),
        elevation_m: Number($("site-elevation").value),
        time_zone: $("site-zone").value,
        push_topic: $("push-topic").value.trim() || null,
      });
      announce("site-updates", "Site saved.");
      refreshTonight();
    } catch (err) {
      if (err.fields) showFieldErrors("error-summary", err.fields);
      else announce("site-updates", err.message);
    }
  });
}

function wireReminder() {
  $("reminder-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("PUT", "/api/reminders/new-moon", {
        enabled: $("reminder-enabled").checked,
        local_time: $("reminder-time").value.trim(),
      });
      announce("site-updates", "Reminder saved.");
      await loadReminders();
    } catch (err) {
      if (err.fields) showFieldErrors("error-summary", err.fields);
      else announce("site-updates", err.message);
    }
  });
}

function wirePainter() {
  const canvas = $("horizon-painter");
  painter = canvas.getContext("2d");
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = 900 * dpr;
  canvas.height = 300 * dpr;

  const binAt = (x) => Math.min(71, Math.max(0, Math.floor((x / canvas.getBoundingClientRect().width) * 72)));

  const paintFromPointer = (event) => {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const bin = binAt(x);
    selectedBin = bin;
    const alt = Math.max(0, Math.min(90, Math.round(90 * (1 - y / rect.height))));
    mask[bin] = alt;
    paintPainter();
  };

  let painting = false;
  canvas.addEventListener("pointerdown", (event) => {
    canvas.setPointerCapture(event.pointerId);
    painting = true;
    paintFromPointer(event);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (painting) paintFromPointer(event);
  });
  const finish = () => {
    if (!painting) return;
    painting = false;
    saveHorizon();
  };
  canvas.addEventListener("pointerup", finish);
  canvas.addEventListener("pointercancel", finish);

  canvas.addEventListener("keydown", (event) => {
    const k = event.key;
    let handled = true;
    if (k === "ArrowLeft") selectedBin = (selectedBin + 71) % 72;
    else if (k === "ArrowRight") selectedBin = (selectedBin + 1) % 72;
    else if (k === "ArrowUp") mask[selectedBin] = Math.min(90, mask[selectedBin] + (event.shiftKey ? 5 : 1));
    else if (k === "ArrowDown") mask[selectedBin] = Math.max(0, mask[selectedBin] - (event.shiftKey ? 5 : 1));
    else handled = false;
    if (handled) {
      event.preventDefault();
      paintPainter();
      clearTimeout(saveTimer);
      saveTimer = setTimeout(saveHorizon, 500);
    }
  });
}

function paintPainter() {
  const canvas = $("horizon-painter");
  const ctx = painter;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#070a13";
  ctx.fillRect(0, 0, w, h);
  // Altitude guides at 30 and 60.
  ctx.strokeStyle = "rgba(143,162,196,0.15)";
  [30, 60].forEach((alt) => {
    ctx.beginPath();
    ctx.moveTo(0, h * (1 - alt / 90));
    ctx.lineTo(w, h * (1 - alt / 90));
    ctx.stroke();
  });
  // The treeline.
  ctx.beginPath();
  ctx.moveTo(0, h);
  mask.forEach((alt, i) => {
    const x0 = (i / 72) * w;
    const x1 = ((i + 1) / 72) * w;
    const y = h * (1 - alt / 90);
    ctx.lineTo(x0, y);
    ctx.lineTo(x1, y);
  });
  ctx.lineTo(w, h);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "rgba(34,211,238,0.35)");
  grad.addColorStop(0.4, "rgba(12,18,32,0.9)");
  grad.addColorStop(1, "#0c1220");
  ctx.fillStyle = grad;
  ctx.fill();
  // The selected bin's edge, lit with the one accent.
  ctx.strokeStyle = "#22d3ee";
  ctx.lineWidth = 2 * dpr;
  ctx.strokeRect((selectedBin / 72) * w, h * (1 - mask[selectedBin] / 90), w / 72, h * (mask[selectedBin] / 90));
  const az = selectedBin * 5;
  canvas.setAttribute("aria-label", `Horizon painter: azimuth ${az} degrees, mask altitude ${mask[selectedBin]} degrees`);
  $("painter-readout").textContent = `Bin ${selectedBin + 1} of 72 · azimuth ${az}-${az + 5} · ${mask[selectedBin]} degrees`;
}

async function saveHorizon() {
  try {
    await api("PUT", "/api/site/horizon", { altitudes: mask });
    announce("site-updates", "Horizon saved.");
    refreshTonight();
  } catch (err) {
    announce("site-updates", "The horizon was not saved. Try again.");
  }
}

boot();
