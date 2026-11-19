import type { SessionUser, Role } from './types.js';

export function el(tag: string, attrs: Record<string, unknown> = {}, ...children: Array<Node | string | null | undefined>): HTMLElement {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = String(value);
    else if (key === 'text') node.textContent = String(value);
    else if (key === 'html') node.innerHTML = String(value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2), value as EventListener);
    } else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function status(text: string): HTMLElement {
  const region = el('span', { role: 'status', class: 'status-line', text });
  return region;
}

export function setStatusText(node: HTMLElement | null, text: string): void {
  if (node) node.textContent = text;
}

export interface FormField {
  name: string;
  label: string;
  value: string;
  control: HTMLInputElement | HTMLSelectElement;
  error?: string;
}

export function moneyInput(label: string, value: string, onInput: () => void): { row: HTMLElement; input: HTMLInputElement } {
  const input = el('input', { type: 'text', value, 'aria-label': label }) as HTMLInputElement;
  input.addEventListener('input', onInput);
  const row = el('div', { class: 'form-row' },
    el('label', { text: label }),
    input);
  return { row, input };
}

/** dollars like 123.45 to cents; returns NaN when invalid */
export function dollarsToCents(text: string): number {
  const trimmed = text.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return Number.NaN;
  const parts = trimmed.split('.');
  const cents = Number(parts[0]) * 100 + (parts[1] ? Number(parts[1].padEnd(2, '0')) : 0);
  return cents;
}

export function centsToDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

export const roleHome: Record<Role, string> = {
  owner: '/desk',
  front_desk: '/desk',
  housekeeper: '/board'
};
