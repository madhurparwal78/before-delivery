// Small DOM helpers. Every screen builds its nodes with these.
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key in node && key !== 'list' && key !== 'type' && key !== 'role') {
      node[key] = value;
    } else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child);
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.firstChild.remove();
  return node;
}

export function field(label, control, options = {}) {
  const id = control.id || `field-${Math.random().toString(36).slice(2)}`;
  control.id = id;
  const wrapper = el('div', { class: 'field' }, [
    el('label', { for: id, text: label }),
    control,
  ]);
  if (options.hint) wrapper.append(el('p', { class: 'hint', text: options.hint }));
  const error = el('p', { class: 'field-error', id: `${id}-error` });
  wrapper.append(error);
  return { wrapper, control, error };
}

export function setFieldError(entry, message) {
  entry.error.textContent = message || '';
  if (message) {
    entry.control.setAttribute('aria-invalid', 'true');
    entry.control.setAttribute('aria-describedby', entry.error.id);
  } else {
    entry.control.removeAttribute('aria-invalid');
    entry.control.removeAttribute('aria-describedby');
  }
}

export function option(value, label, selected = false) {
  return el('option', { value, text: label, selected });
}

export function badge(text) {
  return el('span', { class: 'badge', text });
}
