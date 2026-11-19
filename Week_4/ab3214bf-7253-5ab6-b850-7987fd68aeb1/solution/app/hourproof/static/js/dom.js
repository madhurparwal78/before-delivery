// Tiny DOM helpers: element builder, comma and percent formatting, exact watt-hour scaling.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") el.className = value;
    else if (key === "text") el.textContent = value;
    else if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else if (value === true) el.setAttribute(key, "");
    else el.setAttribute(key, value);
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export function commas(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// Basis points as a two-decimal percent, built from the digits.
export function pct(bp) {
  const digits = String(bp).padStart(3, "0");
  return `${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

// part x scale / whole to four decimals, in BigInt integer arithmetic so no watt-hour passes through a float.
export function share(part, whole, scale) {
  const scaled = (BigInt(part) * BigInt(scale) * 10000n) / BigInt(whole);
  return `${scaled / 10000n}.${String(scaled % 10000n).padStart(4, "0")}`;
}

// A digit string already checked as whole watt-hours, as the integer the API takes.
export function wholeNumber(digits) {
  return parseInt(digits, 10);
}

export function targetWord(window) {
  return window.target.met ? "On target" : "Off target";
}

export function focusables(root) {
  const selector = "a[href], button, input, select, textarea, [tabindex]";
  return [...root.querySelectorAll(selector)].filter((el) => {
    if (el.disabled || el.hidden || el.closest("[hidden], [inert]")) return false;
    if (el.tabIndex < 0 && !el.matches("a[href], button, input, select, textarea")) return false;
    if (el.tabIndex < 0) return false;
    return el.getClientRects().length > 0;
  });
}

export function link(path, text, attrs = {}) {
  return h("a", { href: path, text, ...attrs });
}

export const allocationLine = (w) => `Allocation done. Hour score ${pct(w.scores.hour_bp)} percent. ${w.unmatched_hours} unmatched hours.`;

const two = (n) => String(n).padStart(2, "0");

export function localLabel(hourKey, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
  const read = (ms) => Object.fromEntries(formatter.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  const at = Date.parse(hourKey);
  const now = read(at);
  const before = read(at - 3600000);
  const again = before.day === now.day && before.hour === now.hour ? " again" : "";
  return `${now.year}-${now.month}-${now.day} ${two(Number(now.hour) % 24)}:00${again}`;
}

export function lineText(line) {
  return `${line.lot_name} ${commas(line.wh)} Wh, range ${commas(line.range_start_wh)} to ${commas(line.range_end_wh)}, ${line.status}`;
}

// One allocation line row; a rejected line also shows the registry's own reason, the one provider text the desk keeps.
export function lineItem(line) {
  return h("li", {}, lineText(line), line.status === "Rejected" && line.reason ? h("span", { class: "line-reason", text: ` ${line.reason}` }) : null);
}

// Loading is the panel's own figure replaced by the word COUNTING; real content replaces it in one step.
export function loadingFigure() {
  return h("p", { class: "figure", text: "COUNTING" });
}
