import { el } from './dom.js';

let nextId = 0;

export function statusRegion(name: string): HTMLElement {
  return el('p', { role: 'status', 'aria-live': 'polite', 'aria-label': name, class: 'status' });
}

export function field(
  labelText: string,
  type: 'text' | 'password' | 'email' | 'file' | 'number' | 'search',
  extra: Record<string, string> = {}
): { wrap: HTMLElement; input: HTMLInputElement } {
  nextId += 1;
  const id = `field-${nextId}`;
  const input = el('input', { type, id, ...extra });
  const wrap = el('div', { class: 'field' }, [el('label', { for: id, text: labelText }), input]);
  return { wrap, input };
}

export function textArea(labelText: string): { wrap: HTMLElement; input: HTMLTextAreaElement } {
  nextId += 1;
  const id = `field-${nextId}`;
  const input = el('textarea', { id, rows: '3' });
  const wrap = el('div', { class: 'field' }, [el('label', { for: id, text: labelText }), input]);
  return { wrap, input };
}

export function select(
  labelText: string,
  options: Array<{ label: string; value: string }>,
  value: string | null = null
): { wrap: HTMLElement; input: HTMLSelectElement } {
  nextId += 1;
  const id = `field-${nextId}`;
  const input = el('select', { id });
  for (const option of options) input.append(el('option', { value: option.value, text: option.label }));
  if (value !== null) input.value = value;
  const wrap = el('div', { class: 'field' }, [el('label', { for: id, text: labelText }), input]);
  return { wrap, input };
}

export function button(name: string, kind: 'primary' | 'plain' | 'danger' = 'plain'): HTMLButtonElement {
  return el('button', { type: 'button', class: kind, text: name });
}
