/** Small DOM builder and ARIA helpers. */

export type Child = Node | string | null | undefined | false;

export function h(tag: string, attrs: Record<string, unknown> = {}, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (name === "class") el.className = String(value);
    else if (name === "dataset") Object.assign(el.dataset, value as Record<string, string>);
    else if (name.startsWith("on") && typeof value === "function") el.addEventListener(name.slice(2), value as EventListener);
    else if (value === true) el.setAttribute(name, "");
    else el.setAttribute(name, String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export function clear(el: HTMLElement): void {
  while (el.firstChild !== null) el.removeChild(el.firstChild);
}

export function statusRegion(label: string, id: string): HTMLElement {
  return h("div", { class: "live-status", role: "status", "aria-label": label, id });
}

export function setStatus(el: HTMLElement, text: string): void {
  clear(el);
  el.append(text);
}

export function announce(el: HTMLElement, text: string): void {
  // A repaint never overwrites a message the user's last action just showed.
  setStatus(el, text);
}

export function focusable(el: HTMLElement): void {
  el.setAttribute("tabindex", "0");
}

/** The roving-tabindex grid: exactly one cell of each grid has tabindex="0". */
export function gridPattern(grid: HTMLElement, cols: number, onKey: (cell: HTMLElement, key: string) => void): void {
  const cells = (): HTMLElement[] => Array.from(grid.querySelectorAll<HTMLElement>("[role=gridcell]"));
  const setFocus = (cell: HTMLElement): void => {
    for (const other of cells()) other.setAttribute("tabindex", "-1");
    cell.setAttribute("tabindex", "0");
    cell.focus();
  };
  grid.addEventListener("keydown", (event) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target === null || !grid.contains(target)) return;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
    const cell = target.closest<HTMLElement>("[role=gridcell]") ?? (target as HTMLElement);
    const list = cells();
    const index = list.indexOf(cell);
    if (index < 0) return;
    const key = event.key;
    let next: number | null = null;
    if (key === "ArrowRight") next = Math.min(index + 1, list.length - 1);
    else if (key === "ArrowLeft") next = Math.max(index - 1, 0);
    else if (key === "ArrowDown") next = Math.min(index + cols, list.length - 1);
    else if (key === "ArrowUp") next = Math.max(index - cols, 0);
    else if (key === "Home") next = Math.floor(index / cols) * cols;
    else if (key === "End") next = Math.floor(index / cols) * cols + (cols - 1);
    else if (key === "PageDown") next = Math.min(index + cols * 8, list.length - 1);
    else if (key === "PageUp") next = Math.max(index - cols * 8, 0);
    else if ((key === "Home" || key === "End") && (event.ctrlKey || event.metaKey)) {
      next = key === "Home" ? 0 : list.length - 1;
    } else {
      onKey(cell, key);
      return;
    }
    event.preventDefault();
    if (next !== null) setFocus(list[next]!);
  });
  const first = cells()[0];
  if (first !== undefined) setFocus(first);
}

/** Casts an element built by h() to its concrete form. */
export function asInput(el: HTMLElement): HTMLInputElement {
  return el as unknown as HTMLInputElement;
}

export function asSelect(el: HTMLElement): HTMLSelectElement {
  return el as unknown as HTMLSelectElement;
}

export function asDialog(el: HTMLElement): HTMLDialogElement {
  return el as unknown as HTMLDialogElement;
}
