/**
 * UI helpers: the overlay layer, live regions, dialogs, sheets, menus and
 * the focus traps. One place builds and traps overlays.
 */

export const el = <T extends HTMLElement = HTMLElement>(
  tag: string,
  attrs: Record<string, unknown> = {},
  ...children: (Node | string | null | undefined)[]
): T => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined) continue;
    if (key === 'class') node.className = String(value);
    else if (key === 'text') node.textContent = String(value);
    else if (key === 'html') node.innerHTML = String(value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2), value as EventListener);
    } else if (key === 'dataset') {
      for (const [dk, dv] of Object.entries(value as Record<string, string>)) {
        node.dataset[dk] = dv;
      }
    } else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node as unknown as T;
};

const focusables = (root: HTMLElement): HTMLElement[] =>
  Array.from(
    root.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'),
  ).filter((n) => !n.hasAttribute('disabled') && n.offsetParent !== null);

/** The single overlay layer: last element of the body, above everything. */
export const overlayLayer = (): HTMLElement => {
  let layer = document.getElementById('overlay-layer');
  if (!layer) {
    layer = el('div', { id: 'overlay-layer', class: 'overlay-layer' });
    document.body.append(layer);
  }
  return layer;
};

/** Write a live region message: empty first, then fill, so repeats announce. */
export const announce = (regionId: string, message: string): void => {
  const region = document.getElementById(regionId);
  if (!region) return;
  region.textContent = '';
  window.setTimeout(() => {
    region.textContent = message;
  }, 0);
};

export interface TrapHandle {
  close: () => void;
  root: HTMLElement;
}

/** Open a dialog or sheet with a focus trap; Escape and Tab stay inside. */
export function openOverlay(
  root: HTMLElement,
  opts: { onCancel?: () => void; firstFocus?: HTMLElement | null } = {},
): TrapHandle {
  const layer = overlayLayer();
  root.classList.add('overlay-open');
  layer.append(root);
  const previous = document.activeElement as HTMLElement | null;
  const focusFirst = (): void => {
    const target = opts.firstFocus ?? focusables(root)[0];
    (target ?? root).focus();
  };
  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === 'Tab') {
      const items = focusables(root);
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey && (active === first || !root.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !root.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    }
  };
  const close = (): void => {
    root.removeEventListener('keydown', onKeydown);
    root.remove();
    root.classList.remove('overlay-open');
    if (opts.onCancel) opts.onCancel();
    if (previous && document.contains(previous)) previous.focus();
  };
  root.addEventListener('keydown', onKeydown);
  window.setTimeout(focusFirst, 0);
  return { close, root };
}

/** Place a floating overlay inside the viewport, above the status bar. */
export function placeFloating(
  node: HTMLElement,
  anchorRect: DOMRect,
  opts: { viewportWidth: number; statusBarTop: number },
): void {
  const layer = overlayLayer();
  node.style.visibility = 'hidden';
  layer.append(node);
  const rect = node.getBoundingClientRect();
  let left = anchorRect.left;
  let top = anchorRect.bottom + 2;
  if (left + rect.width > opts.viewportWidth - 8) {
    left = Math.max(8, opts.viewportWidth - rect.width - 8);
  }
  if (top + rect.height > opts.statusBarTop - 8) {
    top = Math.max(8, anchorRect.top - rect.height - 2);
  }
  node.style.left = `${Math.max(8, left)}px`;
  node.style.top = `${Math.max(8, top)}px`;
  node.style.visibility = 'visible';
}

export const reducedMotion = (): boolean =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;
