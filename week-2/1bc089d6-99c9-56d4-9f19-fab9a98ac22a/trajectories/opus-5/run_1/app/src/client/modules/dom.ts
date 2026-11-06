export function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`missing element: ${id}`);
  return found as T;
}

export function create<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Record<string, string> = {},
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  if (text !== undefined) node.textContent = text;
  return node;
}

export const clamp = (value: number, low: number, high: number): number =>
  value < low ? low : value > high ? high : value;

export const formatCount = (value: number): string => value.toLocaleString('en-GB');

export const two = (value: number): string => String(value).padStart(2, '0');

/** Splits a line into per-letter spans so it can be revealed or scattered. */
export function splitLetters(host: HTMLElement): HTMLSpanElement[] {
  const text = host.textContent ?? '';
  host.textContent = '';
  const spans: HTMLSpanElement[] = [];
  for (const character of text) {
    const span = create('span', {}, character);
    host.append(span);
    spans.push(span);
  }
  return spans;
}
