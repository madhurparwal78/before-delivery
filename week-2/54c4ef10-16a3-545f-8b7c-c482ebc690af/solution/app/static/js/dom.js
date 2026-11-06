// Small DOM helpers: element builder, the Activity live region and focus utilities.

export function h(tag, attrs = {}, ...children) {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (name.startsWith('on')) element.addEventListener(name.slice(2), value);
    else if (name === 'class') element.className = value;
    else if (name === 'value') element.value = value;
    else if (name === 'checked' || name === 'disabled' || name === 'selected' || name === 'hidden') element[name] = value;
    else element.setAttribute(name, value === true ? '' : value);
  }
  append(element, children);
  return element;
}

export function append(parent, children) {
  for (const child of [children].flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

export function replace(parent, ...children) {
  parent.replaceChildren();
  return append(parent, children);
}

const activityElement = () => document.getElementById('activity');

/** Announce one message in the polite Activity region; a newer message replaces the older one. */
export function announce(message) {
  activityElement().textContent = message;
}

export function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

let idCounter = 0;
export function uid(prefix) {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

/** A labelled form control with its error slot. Returns {root, input, setError}. */
export function field(label, input, { hint } = {}) {
  const id = input.id || uid('f');
  input.id = id;
  const error = h('p', { class: 'field-error', id: `${id}-error`, hidden: true });
  const root = h('div', { class: 'field' }, h('label', { for: id }, label), input, hint ? h('p', { class: 'count' }, hint) : null, error);
  return {
    root, input, error,
    setError(message) {
      error.hidden = !message;
      error.replaceChildren(...[message ?? []].flat().map((line) => h('div', {}, line)));
      if (message) {
        input.setAttribute('aria-invalid', 'true');
        input.setAttribute('aria-describedby', error.id);
      } else {
        input.removeAttribute('aria-invalid');
        input.removeAttribute('aria-describedby');
      }
    },
  };
}

/** Show each message under its field, focus the first invalid field in reading order and announce its message. */
export function showFieldErrors(fields, messages) {
  let first = null;
  for (const [name, entry] of Object.entries(fields)) {
    entry.setError(messages[name]);
    if (messages[name] && first === null) first = [name, entry];
  }
  if (first) {
    announce([messages[first[0]]].flat()[0]);
    first[1].input.focus();
  }
  return first !== null;
}
