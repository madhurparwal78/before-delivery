// Live regions, the dialog stack, focus traps and the Escape key.

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]),' +
  ' textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function announceStatus(text) {
  document.getElementById("action-status").textContent = text || "";
}

export function announceError(text) {
  document.getElementById("action-error").textContent = text || "";
}

export function announceLive(text) {
  document.getElementById("live-updates").textContent = text || "";
}

export function clearAnnouncements() {
  announceStatus("");
  announceError("");
}

export function element(tag, attributes = {}, children = []) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) continue;
    if (name === "text") node.textContent = value;
    else if (name === "class") node.className = value;
    else if (name === "html") node.innerHTML = value;
    else if (name.startsWith("on")) node.addEventListener(name.slice(2), value);
    else if (name === "dataset") Object.assign(node.dataset, value);
    else node.setAttribute(name, value === true ? "" : value);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

const stack = [];

/** Open a layer: a dialog, the drawer or a menu. */
export function openLayer({ node, modal, opener, onClose, kind }) {
  const layer = { node, modal, opener: opener || document.activeElement, onClose, kind };
  stack.push(layer);
  trap(layer);
  return layer;
}

export function closeLayer(layer, { restoreFocus = true } = {}) {
  const index = stack.indexOf(layer);
  if (index === -1) return;
  stack.splice(index, 1);
  if (layer.release) layer.release();
  if (layer.node && layer.node.parentNode) layer.node.remove();
  if (layer.onClose) layer.onClose();
  if (restoreFocus && layer.opener && document.contains(layer.opener)) {
    layer.opener.focus();
  }
}

export function closeTop() {
  const layer = stack[stack.length - 1];
  if (!layer) return false;
  closeLayer(layer);
  return true;
}

export function closeKind(kind) {
  for (const layer of [...stack]) {
    if (layer.kind === kind) closeLayer(layer, { restoreFocus: false });
  }
}

function trap(layer) {
  const handler = (event) => {
    if (event.key !== "Tab" || !layer.modal) return;
    if (stack[stack.length - 1] !== layer) return;
    const items = focusables(layer.node);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && (document.activeElement === first || !layer.node.contains(
      document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  document.addEventListener("keydown", handler, true);
  layer.release = () => document.removeEventListener("keydown", handler, true);
}

export function focusables(root) {
  return [...root.querySelectorAll(FOCUSABLE)].filter(
    (node) => node.offsetParent !== null || node === document.activeElement
  );
}

export function focusFirst(root) {
  const items = focusables(root);
  if (items.length) items[0].focus();
  else root.focus();
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && stack.length) {
    event.preventDefault();
    closeTop();
  }
});

export function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function narrow() {
  return window.matchMedia("(max-width: 520px)").matches;
}

export function medium() {
  return window.matchMedia("(max-width: 1100px)").matches;
}
