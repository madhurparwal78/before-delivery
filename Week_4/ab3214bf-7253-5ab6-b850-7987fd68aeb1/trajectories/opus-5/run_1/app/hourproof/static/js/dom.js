// Element building and the live regions.

export function el(tag, options = {}, children = []) {
  const node = document.createElement(tag);
  const { text, html, dataset, ...attributes } = options;
  Object.entries(attributes).forEach(([name, value]) => {
    if (value === null || value === undefined || value === false) return;
    if (name === 'className') node.className = value;
    else node.setAttribute(name, value === true ? '' : String(value));
  });
  Object.entries(dataset || {}).forEach(([name, value]) => {
    if (value !== null && value !== undefined) node.dataset[name] = String(value);
  });
  if (text !== undefined) node.textContent = text;
  if (html !== undefined) node.innerHTML = html;
  (Array.isArray(children) ? children : [children])
    .filter((child) => child !== null && child !== undefined && child !== false)
    .forEach((child) => node.append(child));
  return node;
}

export function clear(node) {
  while (node.firstChild) node.firstChild.remove();
}

export function liveRegion(name, kind = 'status') {
  return el('div', {
    role: kind,
    'aria-live': kind === 'alert' ? 'assertive' : 'polite',
    'aria-label': name,
    className: 'visually-hidden',
    dataset: { live: name },
  });
}

const queued = new Map();

export function announce(name, text) {
  // Sequenced lines each get their turn in the region, in order.
  const region = document.querySelector(`[data-live="${name}"]`);
  if (!region) return;
  const waiting = queued.get(name);
  if (!waiting) {
    region.textContent = text;
    queued.set(name, []);
    window.setTimeout(() => drain(name), 400);
    return;
  }
  waiting.push(text);
}

function drain(name) {
  const region = document.querySelector(`[data-live="${name}"]`);
  const waiting = queued.get(name) || [];
  if (!region || !waiting.length) {
    queued.delete(name);
    return;
  }
  region.textContent = waiting.shift();
  window.setTimeout(() => drain(name), 400);
}

export function problems(container, failure) {
  // One link per field inside this form's own alert region.
  clear(container);
  if (!failure) return;
  const fields = failure.fields || null;
  if (fields && Object.keys(fields).length) {
    Object.entries(fields).forEach(([field, message]) => {
      const link = el('a', { href: `#field-${field}`, text: message });
      link.addEventListener('click', (event) => {
        event.preventDefault();
        const target = container
          .closest('[data-form-root]')
          ?.querySelector(`[data-field="${field}"]`);
        if (target) target.focus();
      });
      container.append(link);
    });
    return;
  }
  container.append(el('p', { text: failure.message || '' }));
}

export function focusFirst(root) {
  const field = root.querySelector('input, textarea, select');
  if (field) {
    field.focus();
    return;
  }
  const control = root.querySelector('button, a[href], [tabindex]');
  if (control) control.focus();
}

export function focusable(root) {
  return Array.from(
    root.querySelectorAll(
      'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )
  ).filter((node) => node.offsetParent !== null || node === document.activeElement);
}
