// A tiny reactive layer: h() builds nodes, state holds observable values.

export type Child = Node | string | number | null | undefined | false | true | void;

export interface Attrs {
  [key: string]: unknown;
}

export function h(tag: string, attrs: Attrs | null, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = String(v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') {
        el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      } else if (k === 'value') {
        (el as HTMLInputElement).value = String(v);
      } else if (k === 'checked') {
        (el as HTMLInputElement).checked = Boolean(v);
      } else if (k === 'disabled') {
        (el as HTMLButtonElement).disabled = Boolean(v);
      } else if (v === true) {
        el.setAttribute(k, '');
      } else {
        el.setAttribute(k, String(v));
      }
    }
  }
  append(el, children);
  return el;
}

export function append(el: HTMLElement, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

export interface Component {
  el: HTMLElement;
  destroy?(): void;
}

export function text(s: string): Text {
  return document.createTextNode(s);
}

