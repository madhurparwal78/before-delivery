// Tiny element builder. h('button', {class: 'btn', onclick: fn, 'aria-label': 'x'}, 'text', child)
const BOOLEAN_ATTRIBUTES = new Set(['disabled', 'hidden', 'checked', 'selected', 'readonly', 'required', 'multiple', 'open']);

export function h(tag, props = {}, ...children) {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (name === 'class') element.className = value;
    else if (name === 'dataset') Object.assign(element.dataset, value);
    else if (name === 'style' && typeof value === 'object') Object.assign(element.style, value);
    else if (name.startsWith('on') && typeof value === 'function') element.addEventListener(name.slice(2), value);
    else if (name === 'value' || name === 'checked' || name === 'selected') element[name] = value;
    else if (BOOLEAN_ATTRIBUTES.has(name)) element.setAttribute(name, '');
    else element.setAttribute(name, value === true ? '' : String(value));
  }
  append(element, children);
  return element;
}

export function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

export function replace(parent, ...children) {
  parent.replaceChildren();
  return append(parent, children);
}

export function svg(markup, attributes = {}) {
  const wrapper = document.createElement('template');
  wrapper.innerHTML = markup.trim();
  const element = wrapper.content.firstElementChild;
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  return element;
}

let nextId = 0;
export function uid(prefix = 'id') {
  nextId += 1;
  return `${prefix}-${nextId}`;
}
