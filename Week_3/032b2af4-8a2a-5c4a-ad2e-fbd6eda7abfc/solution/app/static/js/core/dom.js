const SVG_NS = "http://www.w3.org/2000/svg";

function apply(node, props) {
  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") node.setAttribute("class", value);
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (key === "dataset") Object.assign(node.dataset, value);
    else node.setAttribute(key, value === true ? "" : value);
  }
}

function append(node, children) {
  for (const child of children.flat()) {
    if (child === undefined || child === null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
}

/** Builds an HTML element. Text goes in as text nodes, never as markup. */
export function h(tag, props, ...children) {
  const node = document.createElement(tag);
  apply(node, props);
  append(node, children);
  return node;
}

export function s(tag, props, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  apply(node, props);
  append(node, children);
  return node;
}

/** An icon from the page's sprite; `label` makes it an image with a text alternative. */
export function icon(name, className = "", label = "") {
  const node = s("svg", { class: `icon ${className}`.trim() });
  if (label) {
    node.setAttribute("role", "img");
    node.setAttribute("aria-label", label);
  } else {
    node.setAttribute("aria-hidden", "true");
    node.setAttribute("focusable", "false");
  }
  node.append(s("use", { href: `#i-${name}` }));
  return node;
}

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

/** A message in the page: `role="alert"` for refusals, `role="status"` otherwise. */
export function notice(kind, message) {
  const role = kind === "error" ? "alert" : "status";
  return h("p", { class: `notice is-${kind}`, role }, icon(kind === "error" ? "alert" : kind === "success" ? "check" : "info"), h("span", { text: message }));
}

export function fieldError(id, message) {
  return h("span", { class: "field-error", id }, icon("alert"), message);
}
