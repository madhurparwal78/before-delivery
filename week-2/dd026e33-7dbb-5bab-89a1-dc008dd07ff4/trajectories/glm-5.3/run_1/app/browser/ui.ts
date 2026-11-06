/**
 * Live regions and in-place value patching — the single place that announces
 * results. Each announce clears then sets within a frame so a repeated copy
 * is spoken again, and nothing is announced when the text is unchanged by a
 * re-read.
 */

/** Announce text in a status region (clears first so repeats are spoken). */
export function announce(el: HTMLElement | null, text: string): void {
  if (!el) return;
  el.textContent = '';
  window.requestAnimationFrame(() => {
    el.textContent = text;
  });
}

/** Set text only when it changed — used by re-reads, never re-announces. */
export function patchText(el: HTMLElement | null, text: string): void {
  if (!el) return;
  if (el.textContent !== text) el.textContent = text;
}

export function statusRegion(name: string): HTMLParagraphElement {
  const el = document.createElement('p');
  el.className = 'status-region';
  el.setAttribute('role', 'status');
  el.dataset.region = name;
  return el;
}

export function findByRegion(root: HTMLElement, name: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[data-region="${name}"]`);
}

/**
 * Keep a list of rows in place: rows are reused by key and moved to their
 * position, so focus inside a moved row survives. New rows are created with
 * build; existing rows are updated with patch. Rows that vanish are removed.
 */
export function reconcile<T>(
  container: HTMLElement,
  items: T[],
  keyOf: (item: T) => string,
  build: (item: T) => HTMLElement,
  patch: (row: HTMLElement, item: T) => void,
): void {
  const existing = new Map<string, HTMLElement>();
  for (const child of Array.from(container.children)) {
    const key = (child as HTMLElement).dataset.key;
    if (key) existing.set(key, child as HTMLElement);
  }
  const seen = new Set<string>();
  let insertionPoint: ChildNode | null = null;
  for (const item of items) {
    const key = keyOf(item);
    seen.add(key);
    let row = existing.get(key) ?? null;
    if (!row) {
      row = build(item);
      row.dataset.key = key;
    } else {
      patch(row, item);
    }
    // place row at its position
    if (insertionPoint) {
      insertionPoint.after(row);
    } else if (container.firstChild !== row) {
      container.prepend(row);
    }
    insertionPoint = row;
  }
  for (const [key, row] of existing) {
    if (!seen.has(key)) row.remove();
  }
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attributes?: Record<string, unknown> | null, ...children: (Node | string | null | undefined)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attributes) {
    for (const [name, value] of Object.entries(attributes)) {
      if (value === undefined || value === null || value === false) continue;
      if (name === 'class') el.className = String(value);
      else if (name === 'text') el.textContent = String(value);
      else if (name === 'html') el.innerHTML = String(value);
      else if (name.startsWith('on')) {
        const handler = value as (event: Event) => void;
        el.addEventListener(name.slice(2), handler);
      } else if (value === true) el.setAttribute(name, '');
      else el.setAttribute(name, String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    el.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return el;
}
