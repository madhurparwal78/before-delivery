// DOM helpers shared by every screen: element building, keyed lists, dialogs, announcements and motion.

export const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

const PROPS = new Set(['value', 'checked', 'disabled', 'hidden', 'indeterminate', 'selected', 'tabIndex']);

export function h(tag, props = {}, ...children) {
  const el = tag === 'svg' || props.svg ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false || key === 'svg') continue;
    if (key === 'class') el.setAttribute('class', value);
    else if (key === 'text') el.textContent = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (PROPS.has(key)) el[key] = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function setText(el, text) {
  if (el.textContent !== text) el.textContent = text;
}

/**
 * Keeps one element per item, in item order, reusing elements by key so focus and in-flight state survive
 * redraws. Elements are only moved when their position changes.
 */
export function syncKeyed(parent, items, keyOf, create, update) {
  const focused = document.activeElement;
  const existing = new Map();
  for (const child of [...parent.children]) {
    if (child.dataset.key) existing.set(child.dataset.key, child);
    else child.remove();
  }
  let cursor = parent.firstElementChild;
  for (const item of items) {
    const key = keyOf(item);
    let el = existing.get(key);
    if (el) {
      existing.delete(key);
      update(el, item);
    } else {
      el = create(item);
      el.dataset.key = key;
      update(el, item);
    }
    if (el === cursor) cursor = cursor.nextElementSibling;
    else parent.insertBefore(el, cursor);
  }
  for (const el of existing.values()) el.remove();
  if (focused && focused !== document.activeElement && parent.contains(focused)) focused.focus({ preventScroll: true });
}

export function icon(name) {
  const paths = ICONS[name];
  return h('svg', { class: 'icon', viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' },
    ...paths.map((d) => h('path', { svg: true, d })));
}

// Drawn for this app: one stroke weight, square caps, a 24px grid.
const ICONS = {
  grip: ['M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01'],
  edit: ['M4 20h4L19 9l-4-4L4 16v4z', 'M13.5 6.5l4 4'],
  trash: ['M5 7h14', 'M10 4h4', 'M7 7l1 13h8l1-13', 'M10 11v6M14 11v6'],
  plus: ['M12 5v14M5 12h14'],
  menu: ['M4 7h16M4 12h16M4 17h16'],
  exit: ['M14 5h5v14h-5', 'M10 8l-4 4 4 4', 'M6 12h10'],
  alert: ['M12 4l9 16H3L12 4z', 'M12 10v4M12 17h.01'],
  close: ['M6 6l12 12M18 6L6 18'],
};

// --------------------------------------------------------------------------- announcements and alerts

export function announce(status, message) {
  // Clearing first makes a repeated message announce again.
  status.textContent = '';
  status.textContent = message;
}

function alertBox(message, { focus = false, onDismiss = null } = {}) {
  const box = h('div', { class: 'alert', role: 'alert', tabindex: '-1' },
    icon('alert'), h('p', { text: message }),
    h('button', {
      type: 'button', class: 'button button-quiet alert-dismiss', 'aria-label': 'Dismiss',
      onclick: () => { box.remove(); onDismiss?.(); },
    }, icon('close')));
  if (focus) queueMicrotask(() => box.focus());
  return box;
}

export function showAlert(slot, message, options = {}) {
  slot.replaceChildren(alertBox(message, options));
  return slot.firstElementChild;
}

// --------------------------------------------------------------------------- forms

/** Field errors under each field plus an error summary headed "Check these fields". */
export function showFieldErrors(form, summarySlot, fields, labels) {
  for (const old of form.querySelectorAll('.field-error')) old.remove();
  for (const input of form.querySelectorAll('[aria-invalid]')) input.removeAttribute('aria-invalid');
  // The summary lists the errors in the order the fields appear in the form.
  const entries = [...form.querySelectorAll('[data-field]')]
    .map((input) => [input.dataset.field, fields[input.dataset.field], input])
    .filter(([name, message]) => message && labels[name]);
  const links = [];
  for (const [name, message, input] of entries) {
    const id = `${input.id}-error`;
    input.setAttribute('aria-invalid', 'true');
    input.setAttribute('aria-describedby', id);
    const anchor = input.closest('.field') || input;
    anchor.append(h('p', { class: 'field-error', id, text: message }));
    links.push(h('li', {}, h('a', {
      href: `#${input.id}`, text: `${labels[name]}: ${message}`,
      onclick: (event) => { event.preventDefault(); input.focus(); },
    })));
  }
  const summary = h('div', { class: 'error-summary', role: 'alert', tabindex: '-1' },
    h('h3', { text: 'Check these fields' }), h('ul', {}, links));
  summarySlot.replaceChildren(summary);
  queueMicrotask(() => summary.focus());
}

export function clearFieldErrors(form, summarySlot) {
  for (const old of form.querySelectorAll('.field-error')) old.remove();
  for (const input of form.querySelectorAll('[aria-invalid]')) {
    input.removeAttribute('aria-invalid');
    input.removeAttribute('aria-describedby');
  }
  summarySlot.replaceChildren();
}

/** A write in flight: the button is disabled and reads "Working...". */
export function busy(button, on) {
  if (on) {
    button.dataset.label = button.dataset.label || button.textContent;
    button.disabled = true;
    button.textContent = 'Working...';
  } else {
    button.disabled = false;
    if (button.dataset.label) button.textContent = button.dataset.label;
  }
}

// --------------------------------------------------------------------------- dialogs

let uid = 0;
export function nextId(prefix) {
  uid += 1;
  return `${prefix}-${uid}`;
}

/**
 * A modal dialog: focus moves inside, Tab and Shift+Tab wrap, Escape closes, and focus returns to the
 * control that opened it however it closes.
 */
export function openDialog({ title, role = 'dialog', opener, content, initialFocus, onClose }) {
  const titleId = nextId('dialog-title');
  const dialog = h('dialog', { class: `dialog ${role === 'alertdialog' ? 'dialog-alert' : ''}`, 'aria-labelledby': titleId },
    h('h2', { id: titleId, class: 'dialog-title', text: title }), content);
  if (role === 'alertdialog') dialog.setAttribute('role', 'alertdialog');
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    dialog.close();
    dialog.remove();
    onClose?.();
    const target = typeof opener === 'function' ? opener() : opener;
    if (target && document.contains(target)) target.focus();
  };
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(); });
  dialog.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const items = focusables(dialog);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  document.body.append(dialog);
  dialog.showModal();
  const target = initialFocus ? initialFocus(dialog) : focusables(dialog)[0];
  target?.focus();
  return { dialog, close };
}

function focusables(root) {
  return [...root.querySelectorAll('a[href], button, input, select, textarea, [tabindex]')].filter((el) => {
    if (el.disabled || el.tabIndex < 0 || el.closest('[hidden]')) return false;
    if (el.type === 'radio' && !el.checked && root.querySelector(`input[type=radio][name="${el.name}"]:checked`)) return false;
    return el.getClientRects().length > 0;
  });
}

// --------------------------------------------------------------------------- the score numeral

/** Counts a numeral in whole numbers to a target over about 420 ms; restarts from whatever it shows. */
export class Counter {
  constructor(el, duration = 420) {
    this.el = el;
    this.duration = duration;
    this.shown = null;
    this.frame = 0;
  }

  set(value, { animate = true } = {}) {
    cancelAnimationFrame(this.frame);
    if (this.shown === null || !animate || reducedMotion.matches || this.shown === value) {
      this.paint(value);
      return;
    }
    const from = this.shown;
    const start = performance.now();
    const step = () => {
      const t = Math.min(1, (performance.now() - start) / this.duration);
      const eased = 1 - (1 - t) ** 3;
      this.paint(t >= 1 ? value : Math.round(from + (value - from) * eased));
      if (t < 1) this.frame = requestAnimationFrame(step);
    };
    this.frame = requestAnimationFrame(step);
  }

  paint(value) {
    this.shown = value;
    setText(this.el, String(value));
  }
}

// --------------------------------------------------------------------------- formatting

export function formatRemaining(seconds) {
  if (seconds >= 86400) return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export const LEVEL_LABEL = { critical: 'Critical', high: 'High', moderate: 'Moderate', low: 'Low' };
export const LEVELS = ['critical', 'high', 'moderate', 'low'];

export function levelBadge(level) {
  return h('span', { class: `badge badge-${level}` }, LEVEL_LABEL[level]);
}
