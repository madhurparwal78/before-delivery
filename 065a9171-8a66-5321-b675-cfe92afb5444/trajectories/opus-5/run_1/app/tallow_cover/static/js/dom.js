// Small DOM helpers. Accessible names are set explicitly so they match the brief.

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (name === "text") node.textContent = value;
    else if (name === "html") node.innerHTML = value;
    else if (name.startsWith("on")) node.addEventListener(name.slice(2), value);
    else if (name === "dataset") Object.assign(node.dataset, value);
    else if (name === "style") Object.assign(node.style, value);
    else if (name === "class") node.className = value;
    else node.setAttribute(name, value === true ? "" : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** Append children, skipping the ones a condition left out. */
export function append(parent, ...children) {
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    parent.append(child);
  }
  return parent;
}

export function statusRegion(name) {
  return el("div", { role: "status", "aria-label": name, "aria-live": "polite" });
}

export function say(region, message) {
  region.textContent = message;
}

export function field(labelText, control, errorNode) {
  return el("div", {}, el("label", {}, labelText, control), errorNode);
}

export function labelledInput(name, options = {}) {
  return el("input", {
    type: options.type || "text",
    "aria-label": name,
    value: options.value ?? "",
    placeholder: options.placeholder || "",
    min: options.min,
    max: options.max,
    step: options.step,
  });
}

export function select(name, options, value) {
  const node = el("select", { "aria-label": name });
  for (const option of options) {
    node.append(el("option", { value: option.value, selected: option.value === value }, option.label));
  }
  return node;
}

export function showFieldErrors(container, errors) {
  for (const node of container.querySelectorAll("[data-error-for]")) {
    const message = errors?.[node.dataset.errorFor];
    node.textContent = message || "";
  }
}

export function errorSlot(fieldName) {
  return el("p", { class: "field-error", dataset: { errorFor: fieldName } });
}

export function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Focus stays inside an open dialog and returns to its opener on close. */
export function openDialog(dialog, focusTarget, opener) {
  document.body.append(dialog);
  dialog.addEventListener("close", () => {
    dialog.remove();
    opener?.focus();
  });
  dialog.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const focusable = [...dialog.querySelectorAll("button, input, select, textarea, a[href]")].filter(
      (node) => !node.disabled
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  dialog.showModal();
  focusTarget?.focus();
}
