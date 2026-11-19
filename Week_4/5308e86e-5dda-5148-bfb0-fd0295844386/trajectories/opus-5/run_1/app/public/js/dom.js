// Small DOM helpers and the original line glyphs.

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else node.setAttribute(key, value === true ? '' : String(value));
  }
  append(node, children);
  return node;
}

export function append(node, children) {
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'string' || typeof child === 'number' ? String(child) : child);
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function frag(children) {
  const fragment = document.createDocumentFragment();
  append(fragment, children);
  return fragment;
}

const GLYPHS = {
  arrowRight: 'M4 12h15m-6-6 6 6-6 6',
  arrowUpRight: 'M7 17 17 7m-7 0h7v7',
  clock: 'M12 7v5l3.5 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z',
  chevronDown: 'm5 9 7 7 7-7',
  play: 'M8 5l11 7-11 7V5Z',
  speaker: 'M4 10v4h3l5 4V6L7 10H4Zm12-2a5 5 0 0 1 0 8',
  copy: 'M9 9h10v10H9V9ZM5 15V5h10',
  menu: 'M4 7h16M4 12h16M4 17h16',
  bin: 'M5 7h14M9 7V5h6v2m-8 0 1 13h8l1-13',
  search: 'm20 20-5.2-5.2M15 10a5 5 0 1 1-10 0 5 5 0 0 1 10 0Z',
};

export function icon(name, { size = 18, label } = {}) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  if (label) {
    svg.setAttribute('role', 'img');
    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.textContent = label;
    svg.append(title);
  } else {
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
  }
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', GLYPHS[name] || GLYPHS.arrowRight);
  svg.append(path);
  return svg;
}

// The Tallwind mark: an original looping knot.
export function mark(size = 26) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 32 32');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2.2');
  svg.setAttribute('stroke-linecap', 'round');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute(
    'd',
    'M8 22c-5 0-5-7 0-7s9 7 15 7 5-9-1-9-9 5-14 5'
  );
  svg.append(path);
  return svg;
}

export function focusables(node) {
  return [
    ...node.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    ),
  ].filter((candidate) => candidate.offsetParent !== null || candidate === document.activeElement);
}

// A dialog or drawer keeps Tab inside itself.
export function trapTab(container, event) {
  if (event.key !== 'Tab') return;
  const items = focusables(container);
  if (items.length === 0) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (event.shiftKey && (document.activeElement === first || !container.contains(document.activeElement))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// A pending control keeps its place in the Tab order and its focus: the
// `disabled` attribute would move focus to the page body.
export function setBusy(button, pendingLabel) {
  if (button.dataset.restLabel === undefined) button.dataset.restLabel = button.textContent;
  button.textContent = pendingLabel;
  button.setAttribute('aria-disabled', 'true');
  button.setAttribute('aria-busy', 'true');
}

export function clearBusy(button) {
  if (button.dataset.restLabel !== undefined) {
    button.textContent = button.dataset.restLabel;
    delete button.dataset.restLabel;
  }
  button.removeAttribute('aria-disabled');
  button.removeAttribute('aria-busy');
}

export function isBusy(button) {
  return button.getAttribute('aria-disabled') === 'true';
}

// Put a node at a position without moving it when it is already there, so the
// focus inside it survives a refresh.
export function placeAfter(parent, node, previous) {
  if (previous) {
    if (previous.nextElementSibling !== node) previous.after(node);
    return;
  }
  if (parent.firstElementChild !== node) parent.prepend(node);
}
