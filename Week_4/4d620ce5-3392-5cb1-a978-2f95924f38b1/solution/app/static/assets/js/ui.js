// Shared browser helpers: DOM building, layers (dialogs, menus, drawer) with Escape and focus return,
// live-region announcements and display formatting. Focus trapping is adapted from kit/modules/a11y_dialog.

export const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
export const narrow = () => matchMedia("(max-width: 1023px)").matches;
export const phone = () => matchMedia("(max-width: 639px)").matches;

/** Build an element: h("button", {class: "x", onclick}, "Label", child) */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v === null || v === undefined) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (k === "html") el.innerHTML = v;
    else if (k === "dataset") Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function esc(text) {
  return String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

const FOCUSABLE = "a[href], button, input:not([type=hidden]), select, textarea, [tabindex]";

export function focusables(root) {
  return [...root.querySelectorAll(FOCUSABLE)].filter((el) =>
    !el.disabled && !el.closest("[hidden], [inert]") && el.getAttribute("tabindex") !== "-1" && el.getClientRects().length);
}

// Layers: the topmost closes on Escape and returns focus to its opener.
const layers = [];

export function pushLayer({ el, opener, trap = false, close }) {
  const layer = { el, opener, trap: typeof trap === "function" ? trap : () => trap, close, open: true };
  layers.push(layer);
  return layer;
}

export function popLayer(layer, { restore = true } = {}) {
  const i = layers.indexOf(layer);
  if (i === -1) return;
  layers.splice(i, 1);
  layer.open = false;
  if (restore && layer.opener && layer.opener.isConnected) layer.opener.focus();
}

function topLayer() {
  return layers[layers.length - 1];
}

document.addEventListener("keydown", (e) => {
  const layer = topLayer();
  if (!layer) return;
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    layer.close();
    return;
  }
  if (e.key === "Tab" && layer.trap()) {
    const items = focusables(layer.el);
    if (!items.length) return e.preventDefault();
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (!layer.el.contains(active)) {
      e.preventDefault();
      first.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    }
  }
}, true);

/** A modal dialog with a backdrop. Returns {el, body, close}. */
export function modal({ label, title, onClose, wide = false }) {
  const overlays = document.getElementById("overlays");
  const opener = document.activeElement;
  const backdrop = h("div", { class: "backdrop" });
  const closeBtn = h("button", { type: "button", class: "icon-btn dlg__close", "aria-label": "Close dialog" });
  closeBtn.innerHTML = ICON_CLOSE;
  const heading = h("h2", { class: "dlg__title" }, title || label);
  const body = h("div", { class: "dlg__body" });
  const el = h("div", { class: "dlg" + (wide ? " dlg--wide" : ""), role: "dialog", "aria-modal": "true", "aria-label": label },
    h("div", { class: "dlg__head" }, heading, closeBtn), body);
  const wrap = h("div", { class: "dlg-wrap" }, backdrop, el);
  overlays.append(wrap);
  let layer;
  const close = () => {
    if (!layer.open) return;
    popLayer(layer);
    wrap.remove();
    onClose?.();
  };
  layer = pushLayer({ el, opener, trap: true, close });
  closeBtn.addEventListener("click", close);
  backdrop.addEventListener("click", close);
  queueMicrotask(() => (focusables(body)[0] || closeBtn).focus());
  return { el, body, close };
}

export const ICON_CLOSE = '<svg viewBox="0 0 16 16" aria-hidden="true" class="ico"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9"/></svg>';

// Live regions --------------------------------------------------------------------------------------------------

const region = (id) => document.getElementById(id);
let statusTimer = null;

export function announce(text) {
  const el = region("action-status");
  clearTimeout(statusTimer);
  el.textContent = "";
  statusTimer = setTimeout(() => { el.textContent = text; }, 30);
}

export function clearError() {
  region("action-error").textContent = "";
}

export function pending(text) {
  clearError();
  announce(text);
}

export function fail(text) {
  const el = region("action-error");
  el.textContent = "";
  setTimeout(() => { el.textContent = text; }, 30);
}

export function liveFeed(text) {
  region("live-updates").textContent = text;
}

// Formatting (display only; every value comes from the server) ----------------------------------------------------

const LONDON = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  hourCycle: "h23",
});

export function when(iso) {
  if (!iso) return "—";
  const p = Object.fromEntries(LONDON.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

export const hours = (n) => (n === null || n === undefined ? "—" : Number(n).toFixed(1));
export const bytes = (n) => `${n.toLocaleString("en-GB")} bytes`;
export const MODEL_LABELS = { "ATR72-212A": "ATR 72", "DHC-8-402": "Dash 8-400", "ERJ-170-200": "E175" };
export const ROLE_LABELS = {
  compliance_planner: "Compliance planner", licensed_inspector: "Licensed inspector",
  certifying_engineer: "Certifying engineer", records_clerk: "Records clerk", regulator_auditor: "Regulator auditor",
};
export const AUTHORITIES = ["EASA", "UK CAA", "ATR", "De Havilland", "Embraer"];
export const dname = (d) => `${d.authority} ${d.number}`;

/** Show a field's message under it and mark it invalid. */
export function fieldError(input, message) {
  const holder = input.closest(".field") || input.parentElement;
  let note = holder.querySelector(":scope > .field__error");
  if (!note) {
    note = h("p", { class: "field__error", id: `err-${Math.random().toString(36).slice(2, 9)}` });
    holder.append(note);
  }
  note.textContent = message;
  input.setAttribute("aria-invalid", "true");
  input.setAttribute("aria-describedby", note.id);
}

export function clearFieldErrors(root) {
  root.querySelectorAll(".field__error").forEach((n) => n.remove());
  root.querySelectorAll("[aria-invalid]").forEach((n) => { n.removeAttribute("aria-invalid"); n.removeAttribute("aria-describedby"); });
}

/** Run an async control action with its pending text on the button; the button keeps its accessible name. */
export async function busy(button, fn) {
  if (button) {
    button.setAttribute("aria-disabled", "true");
    button.classList.add("is-busy");
  }
  try {
    return await fn();
  } finally {
    if (button) {
      button.removeAttribute("aria-disabled");
      button.classList.remove("is-busy");
    }
  }
}
