/** Small DOM helpers shared by every screen. */

export function el(tag, attributes = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'text') {
      node.textContent = String(value);
    } else if (key === 'html') {
      node.innerHTML = value;
    } else if (key === 'class') {
      node.className = value;
    } else if (key === 'on') {
      for (const [event, handler] of Object.entries(value)) {
        node.addEventListener(event, handler);
      }
    } else if (key === 'dataset') {
      for (const [name, item] of Object.entries(value)) {
        node.dataset[name] = item;
      }
    } else if (key in node && key !== 'list' && typeof value !== 'object') {
      try {
        node[key] = value;
      } catch (error) {
        node.setAttribute(key, String(value));
      }
    } else {
      node.setAttribute(key, String(value));
    }
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.firstChild.remove();
}

export function announce(region, text) {
  if (!region) return;
  if (region.textContent === text) {
    region.textContent = '';
  }
  region.textContent = text;
}

export function icon(mark) {
  return el('span', { class: 'inline-icon', 'aria-hidden': 'true', text: mark });
}

export function verdictCell(verified) {
  return el('span', { class: verified ? 'verified' : 'refusal' }, [
    icon(verified ? '\u2713' : '\u2717'),
    ' ',
    verified ? 'Verified' : 'Altered',
  ]);
}

export function heldMarker() {
  return el('span', { dataset: { heldMarker: 'true' } }, [icon('\u26D4'), ' Held']);
}

export function sealMark() {
  return el('span', { dataset: { sealMark: 'closed' } }, [icon('\u26AD'), ' Sealed']);
}

export function focusables(root) {
  return Array.from(
    root.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ).filter((node) => node.offsetParent !== null || node === document.activeElement);
}

export function takeFocus(node) {
  if (!node) return;
  if (!node.hasAttribute('tabindex') && !focusableTag(node)) {
    node.setAttribute('tabindex', '-1');
  }
  node.focus();
}

function focusableTag(node) {
  return ['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(node.tagName);
}

export function reducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

