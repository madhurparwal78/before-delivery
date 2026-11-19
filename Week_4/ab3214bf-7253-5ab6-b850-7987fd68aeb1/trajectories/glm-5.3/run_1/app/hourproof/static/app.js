/* Hourproof Settlement Desk — one-page app, served from the app itself.
   Every time-based state comes from the server's clock. */
"use strict";

const $app = document.getElementById("app");
let ME = null;               // signed-in user or null
let SERVER_NOW = null;       // latest server time (Date)
let lastServerNowAt = 0;     // performance.now() when SERVER_NOW was set

const thousandRE = /\B(?=(\d{3})+(?!\d))/g;
const fmtThousands = (n) => String(n).replace(thousandRE, ",");
const pct = (bp) => `${(bp / 100).toFixed(2)}`;
const bpPct = (bp) => `${Math.floor(bp / 100)}.${String(bp % 100).padStart(2, "0")}`;

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (key === "dataset") Object.assign(node.dataset, value);
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

function land(mount) { $app.replaceChildren(); $app.append(mount); }

/* --- API client ---------------------------------------------------------- */
async function api(method, path, body, opts = {}) {
  const init = { method, headers: {}, credentials: "same-origin" };
  if (body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const resp = await fetch(path, init);
  const isPdf = opts.pdf === true;
  if (isPdf && resp.ok) return resp.blob();
  let payload = null;
  const text = await resp.text();
  try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
  if (payload && payload.server_now) setServerNow(payload.server_now);
  if (resp.status === 401 && !opts.noDialog && ME) {
    openSignInAgain(method, path, body, opts);
    const err = new Error("UNAUTHENTICATED");
    err.code = "UNAUTHENTICATED"; err.status = 401;
    throw err;
  }
  if (!resp.ok) {
    const err = new Error((payload && payload.error && payload.error.message) || "Request failed");
    err.status = resp.status;
    err.code = payload && payload.error && payload.error.code;
    err.fields = (payload && payload.error && payload.error.fields) || {};
    err.body = payload && payload.error;
    throw err;
  }
  return payload;
}

function setServerNow(iso) {
  SERVER_NOW = new Date(iso + "Z");
  lastServerNowAt = performance.now();
  document.documentElement.dataset.serverNow = iso;
}
function settlementNow() {
  const elapsed = (performance.now() - lastServerNowAt) / 1000;
  return new Date(SERVER_NOW.getTime() + elapsed * 1000);
}
function fmtInstant(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} UTC`;
}
function fmtCountdown(secondsLeft) {
  const s = Math.max(0, Math.ceil(secondsLeft));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const p = (n) => String(n).padStart(2, "0");
  return `${d}d ${p(h)}h ${p(m)}m ${p(sec)}s left`;
}
function localHourLabel(row) {
  // gridcell name: "<local date> <local hour> local, <UTC hour> UTC, ..."
  return row.name;
}

/* Timer registry: every countdown runs from the server's remaining seconds. */
const timers = new Set();
function timerEl(name, fetchUpdate, initialSeconds) {
  const t = el("span", { role: "timer", "aria-label": name, text: fmtCountdown(initialSeconds) });
  const state = { el: t, remaining: initialSeconds, asked: false, fetchUpdate };
  timers.add(state);
  return t;
}
setInterval(() => {
  const now = settlementNow();
  for (const t of timers) {
    if (t.el.isConnected) {
      t.remaining -= 1;
      if (t.remaining <= 0 && !t.asked) {
        t.asked = true;
        t.fetchUpdate().then((seconds) => {
          t.asked = false;
          if (seconds !== null && seconds !== undefined) t.remaining = seconds;
        }).catch(() => { t.asked = false; });
      }
      if (t.remaining < 0) t.remaining = 0;
      t.el.textContent = fmtCountdown(t.remaining);
    }
  }
}, 1000);

/* Settlement time in the top bar, updated every second from server time. */
function settlementTimer() {
  const t = el("span", { role: "timer", "aria-label": "Settlement time" });
  const paint = () => { t.textContent = fmtInstant(settlementNow()); };
  paint();
  setInterval(paint, 1000);
  return t;
}
