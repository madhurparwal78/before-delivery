// Small DOM helpers: build elements, announce in live regions, motion preference.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") el.className = value;
    else if (key === "text") el.textContent = value;
    else if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

const SVG = "http://www.w3.org/2000/svg";

export function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  el.append(...children);
  return el;
}

export function status(name) {
  return h("p", { role: "status", "aria-label": name, "aria-live": "polite", class: "status" });
}

export function say(region, text, tone = "info") {
  region.textContent = text;
  region.dataset.tone = tone;
}

export function reducedMotion() {
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function narrow() {
  return matchMedia("(max-width: 599px)").matches;
}

export function field(label, control, id) {
  control.id = id;
  return h("div", { class: "field" }, h("label", { for: id, text: label }), control,
    h("p", { class: "field-error", id: `${id}-error` }));
}

export function showFieldErrors(form, errors, names) {
  for (const p of form.querySelectorAll(".field-error")) p.textContent = "";
  for (const input of form.querySelectorAll("[aria-invalid]")) input.removeAttribute("aria-invalid");
  for (const [apiField, inputId] of Object.entries(names)) {
    const message = errors?.[apiField];
    if (!message) continue;
    const input = form.querySelector(`#${inputId}`);
    input.setAttribute("aria-invalid", "true");
    input.setAttribute("aria-describedby", `${inputId}-error`);
    form.querySelector(`#${inputId}-error`).textContent = message;
  }
}
