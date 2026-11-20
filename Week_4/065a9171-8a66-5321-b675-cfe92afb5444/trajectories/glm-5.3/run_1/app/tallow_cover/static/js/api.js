/* API access, tiny DOM helpers and shared UI pieces. */

const api = {
  async call(method, path, body, headers) {
    const opts = { method, headers: { ...(headers || {}) }, credentials: "same-origin" };
    if (body !== undefined && !(body instanceof FormData)) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    } else if (body instanceof FormData) {
      opts.body = body;
    }
    let response;
    try {
      response = await fetch(path, opts);
    } catch (err) {
      const offline = new Error("Couldn't reach Tallow. Check your connection and try again.");
      offline.offline = true;
      throw offline;
    }
    if (response.status === 204) return null;
    let data = null;
    try { data = await response.json(); } catch (err) { data = null; }
    if (!response.ok) {
      const err = new Error((data && data.message) || "Something went wrong.");
      err.body = data;
      err.status = response.status;
      throw err;
    }
    return data;
  },
  get(path) { return api.call("GET", path); },
  post(path, body) { return api.call("POST", path, body === undefined ? {} : body); },
  patch(path, body, headers) { return api.call("PATCH", path, body, headers); },
  del(path) { return api.call("DELETE", path); },
};

function h(tag, attrs, ...children) {
  if (typeof tag !== "string") { throw new Error("bad tag"); }
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") el.className = value;
    else if (key === "dataset") Object.assign(el.dataset, value);
    else if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2), value);
    } else if (key === "text") el.textContent = value;
    else if (value === true) el.setAttribute(key, "");
    else el.setAttribute(key, value);
  }
  for (const child of children.flat(20)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return el;
}

function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

function formatDateLabel(isoDate) {
  const date = new Date(isoDate + "T00:00:00Z");
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${days[date.getUTCDay()]} ${date.getUTCDate()} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function shiftLabel(entry) {
  return `${formatDateLabel(entry.date)} ${shiftWord(entry.shift)}`;
}

function shiftWord(shift) {
  return { early: "Early", late: "Late", night: "Night" }[shift] || shift;
}

function shortLabelFor(dateIso, shift) {
  const date = new Date(dateIso + "T00:00:00Z");
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return `${days[(date.getUTCDay() + 6) % 7]} ${shiftWord(shift)}`;
}

function hmOf(isoInstant) {
  const date = new Date(isoInstant);
  return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
}

const TYPE_LABEL = { annual: "Annual leave", unpaid: "Unpaid leave", compassionate: "Compassionate leave" };
const STATUS_LABEL = { draft: "Draft", submitted: "Submitted", escalated: "Escalated",
  cover_pending: "Cover pending", approved: "Approved", declined: "Declined",
  withdrawn: "Withdrawn", cancelled: "Cancelled" };

function statusLine(name) {
  return h("div", { class: "status", role: "status", "aria-label": name,
                    "aria-live": "polite", text: "" });
}

function setStatus(el, text) {
  if (el) el.textContent = text;
}

function fieldError(field, message) {
  const el = h("div", { class: "field-error", text: message });
  el.dataset.for = field;
  return el;
}

/* A labelled field with an inline error slot. */
function field({ label, name, type = "text", value = "", hint }) {
  const input = h(type === "textarea" ? "textarea" : "input",
    { id: `f-${name}`, name, type: type === "textarea" ? undefined : type },
    type === "textarea" ? (value || "") : undefined);
  if (type !== "textarea") input.value = value;
  const wrap = h("div", { class: "field" },
    h("label", { for: `f-${name}`, text: label }),
    input,
    h("div", { class: "field-errors" }));
  wrap.input = input;
  wrap.errorHost = wrap.querySelector(".field-errors");
  wrap.showError = (message) => {
    clear(wrap.errorHost);
    if (message) wrap.errorHost.append(fieldError(name, message));
  };
  return wrap;
}

function selectField({ label, name, options, value }) {
  const select = h("select", { id: `f-${name}`, name },
    options.map(([optValue, text]) =>
      h("option", { value: optValue, selected: String(optValue) === String(value) ? true : null, text })));
  const wrap = h("div", { class: "field" },
    h("label", { for: `f-${name}`, text: label }), select,
    h("div", { class: "field-errors" }));
  wrap.input = select;
  wrap.errorHost = wrap.querySelector(".field-errors");
  wrap.showError = (message) => {
    clear(wrap.errorHost);
    if (message) wrap.errorHost.append(fieldError(name, message));
  };
  return wrap;
}

function showFieldErrors(wraps, errors) {
  for (const wrap of Object.values(wraps)) wrap.showError(null);
  if (!errors) return;
  for (const [name, message] of Object.entries(errors)) {
    if (wraps[name]) wraps[name].showError(message);
  }
}

function dialog({ title, onClose, build }) {
  const closeBtn = h("button", { class: "btn secondary", text: "Close", "aria-label": "Close" });
  const box = h("div", { class: "dialog", role: "dialog", "aria-label": title, "aria-modal": "true" });
  const backdrop = h("div", { class: "dialog-backdrop" }, box);
  box.append(h("h2", { text: title }));
  const body = h("div", {});
  box.append(body, h("div", { class: "action-row" }, closeBtn));
  const opener = document.activeElement;
  const close = () => {
    backdrop.remove();
    if (opener && opener.isConnected) opener.focus();
  };
  closeBtn.addEventListener("click", () => { close(); if (onClose) onClose(); });
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) { close(); if (onClose) onClose(); }
  });
  const focusables = () => box.querySelectorAll("button, input, select, textarea, a[href]");
  box.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { event.stopPropagation(); close(); if (onClose) onClose(); }
    if (event.key === "Tab") {
      const items = Array.from(focusables()).filter((el) => !el.disabled);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  build(body, close);
  document.body.append(backdrop);
  const firstInput = box.querySelector("input, select, textarea");
  if (firstInput) firstInput.focus(); else closeBtn.focus();
  return { close };
}
