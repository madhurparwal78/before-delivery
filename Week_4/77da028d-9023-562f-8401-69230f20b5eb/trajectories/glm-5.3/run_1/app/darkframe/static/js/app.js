/* Shared browser state: API access, formatting, the verdict card, dialogs. */

const state = {
  key: null,
  imager: null,
  tonight: null,
  screen: document.body.dataset.screen,
};

export function authHeaders() {
  return state.key ? { Authorization: `Bearer ${state.key}` } : {};
}

export async function api(method, path, body, opts = {}) {
  const headers = { ...authHeaders() };
  if (body !== undefined && !(body instanceof Blob) && !(body instanceof ArrayBuffer) && !(body instanceof File)) {
    headers["Content-Type"] = "application/json";
  }
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
  const response = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : body instanceof Blob || body instanceof File || body instanceof ArrayBuffer ? body : JSON.stringify(body),
    credentials: "same-origin",
  });
  let data = null;
  const type = response.headers.get("content-type") || "";
  if (type.includes("json")) data = await response.json().catch(() => null);
  if (!response.ok) {
    const err = new Error((data && data.error && data.error.message) || "That did not work.");
    err.status = response.status;
    err.code = data && data.error && data.error.code;
    err.fields = (data && data.error && data.error.fields) || null;
    err.mismatches = (data && data.error && data.error.mismatches) || null;
    throw err;
  }
  return data;
}

export function readKey() {
  const stored = localStorage.getItem("darkframe_key");
  state.key = stored;
  return stored;
}

export function saveKey(key) {
  state.key = key;
  localStorage.setItem("darkframe_key", key);
}

export function clearKey() {
  state.key = null;
  localStorage.removeItem("darkframe_key");
}

export function duration(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  return `${hours} h ${String(minutes).padStart(2, "0")} min`;
}

export function overBy(seconds) {
  const s = Math.abs(Math.round(seconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  return `Over by ${hours} h ${String(minutes).padStart(2, "0")} min`;
}

export function owedText(seconds) {
  return seconds < 0 ? overBy(seconds) : duration(seconds);
}

export function longDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${weekdays[dt.getUTCDay()]} ${d} ${months[m - 1]} ${y}`;
}

export function hmFromLocal(iso) {
  return (iso || "").slice(-11, -6) || "";
}

const STATUS_TEXT = {
  clear: "Clear",
  "behind-treeline": "Behind the treeline",
  "below-minimum": "Below minimum altitude",
  "below-horizon": "Below the horizon",
};
export function statusText(status) {
  return STATUS_TEXT[status] || status;
}

export function announce(regionId, text) {
  const region = document.getElementById(regionId);
  if (!region) return;
  region.textContent = "";
  const line = document.createElement("p");
  line.textContent = text;
  region.appendChild(line);
}

export function showFieldErrors(summaryId, fields) {
  const summary = document.getElementById(summaryId);
  if (!summary) return;
  summary.hidden = false;
  summary.textContent = "";
  const head = document.createElement("p");
  head.textContent = "Check the highlighted fields.";
  summary.appendChild(head);
  const list = document.createElement("ul");
  Object.entries(fields || {}).forEach(([field, message]) => {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = "#";
    a.textContent = message;
    a.dataset.fieldError = field;
    a.addEventListener("click", (event) => {
      event.preventDefault();
      focusField(field);
    });
    li.appendChild(a);
    list.appendChild(li);
  });
  summary.appendChild(list);
}

export function clearFieldErrors(summaryId) {
  const summary = document.getElementById(summaryId);
  if (summary) summary.hidden = true;
  document.querySelectorAll("[data-field-error-target]").forEach((el) => {
    el.textContent = "";
  });
}

export function focusField(field) {
  const key = field.replace(/\[\d+\]/g, "").replace("site.", "");
  const el =
    document.querySelector(`[name="${field}"]`) ||
    document.querySelector(`[data-field="${key}"]`) ||
    document.querySelector(`#${cssId(key)}`);
  if (el) el.focus();
}

function cssId(key) {
  return key.replace(/[^a-z0-9_-]/gi, "-");
}

/* ------------------------------------------------------------------ */
/* The tonight verdict card, painted from one plan body. */

export function verdictCardHtml(plan) {
  const verdictWord = plan.verdict === "go" ? "Go" : plan.verdict === "no-go" ? "No-go" : "Unknown";
  const usable = plan.best ? plan.best.usable_minutes : 0;
  const owedAfter = (plan.targets || []).reduce(
    (sum, t) => (t.counts ? sum + (t.filters || []).reduce((s, f) => s + f.owed_after_tonight_seconds, 0) : sum),
    0
  );
  const moonPct = Math.round(plan.moon.illumination * 100);
  const bestLine = plan.best
    ? `Best: ${plan.best.target_name} in ${plan.best.filter}`
    : "";
  const w = plan.clear_window;
  let countdown = "No clear window tonight";
  if (plan.is_tonight) {
    if (!w) countdown = "No clear window tonight";
    else if (w.starts_in_minutes > 0) {
      const h = Math.floor(w.starts_in_minutes / 60);
      const mm = String(w.starts_in_minutes % 60).padStart(2, "0");
      countdown = `Clear window opens in ${h} h ${mm} min`;
    } else {
      countdown = `Clear window open until ${hmFromLocal(w.end)}`;
    }
  } else {
    countdown = w ? `Clear window ${hmFromLocal(w.start)}-${hmFromLocal(w.end)}` : "No clear window";
  }
  return { verdictWord, usable, owedAfter, moonPct, bestLine, countdown };
}

export function paintVerdictCard(el, plan) {
  if (!el) return;
  const parts = verdictCardHtml(plan);
  el.dataset.verdict = plan.verdict;
  const word = el.querySelector(".verdict-word");
  if (word) word.textContent = parts.verdictWord;
  const best = el.querySelector(".v-best");
  if (best) {
    best.textContent = parts.bestLine;
    best.hidden = !plan.best;
  }
  const usable = el.querySelector(".v-usable");
  if (usable) usable.textContent = `${parts.usable} usable minutes`;
  const owed = el.querySelector(".v-owed");
  if (owed) owed.textContent = `Owed after tonight: ${owedText(parts.owedAfter)}`;
  const moon = el.querySelector(".v-moon");
  if (moon) moon.textContent = `Moon ${parts.moonPct}% lit`;
  const count = el.querySelector(".v-countdown");
  if (count) count.textContent = parts.countdown;
  const push = el.querySelector(".v-push");
  if (push) push.textContent = "";
}

/* ------------------------------------------------------------------ */
/* Dialogs: focus wrap, escape, return focus. */

export function openDialog(dialog, opener) {
  dialog._opener = opener || document.activeElement;
  dialog.showModal();
  const focusable = dialogFocusable(dialog);
  (focusable[0] || dialog).focus();
}

export function closeDialog(dialog) {
  const opener = dialog._opener;
  dialog.close();
  if (opener && opener.isConnected) opener.focus();
}

export function wireDialog(dialog) {
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeDialog(dialog);
      return;
    }
    if (event.key !== "Tab") return;
    const items = dialogFocusable(dialog);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  dialog.querySelectorAll("[data-close]").forEach((btn) =>
    btn.addEventListener("click", () => closeDialog(dialog))
  );
}

export function dialogFocusable(root) {
  return Array.from(
    root.querySelectorAll("button, input, select, textarea, [tabindex]:not([tabindex='-1'])")
  ).filter((el) => !el.disabled && el.offsetParent !== null || el === document.activeElement);
}

/* Every private screen re-reads tonight at least every 60 seconds. */

let tonightTimer = null;
let tonightListener = null;

export function startTonightRefresh(listener) {
  tonightListener = listener;
  if (tonightTimer) clearInterval(tonightTimer);
  tonightTimer = setInterval(async () => {
    try {
      const plan = await api("GET", "/api/tonight");
      if (tonightListener) tonightListener(plan);
    } catch (err) {
      /* a failed refresh never replaces figures */
    }
  }, 55_000);
}

export function el(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  if (text !== undefined) node.textContent = text;
  return node;
}
