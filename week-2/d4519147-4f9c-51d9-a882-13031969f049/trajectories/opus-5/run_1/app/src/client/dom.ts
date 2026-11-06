import { labelRuns } from '../shared/labels';

type Attributes = Record<string, string | number | boolean | null | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  children: Array<Node | string> = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  applyAttributes(node, attributes);
  for (const child of children) node.append(child);
  return node;
}

export function svgEl(tag: string, attributes: Attributes = {}, children: Array<Node | string> = []): SVGElement {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag) as SVGElement;
  applyAttributes(node, attributes);
  for (const child of children) node.append(child);
  return node;
}

function applyAttributes(node: Element, attributes: Attributes): void {
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) continue;
    if (name === 'class') node.setAttribute('class', String(value));
    else if (name === 'text') node.textContent = String(value);
    else node.setAttribute(name, String(value));
  }
}

/** Renders a stored label as inert text, with only the acting tags as formatting. */
export function renderLabel(target: Node, label: string): void {
  for (const run of labelRuns(label)) {
    if (run.kind === 'break') {
      target.appendChild(document.createElement('br'));
      continue;
    }
    let node: Node = document.createTextNode(run.text);
    if (run.italic) {
      const italic = document.createElement('i');
      italic.appendChild(node);
      node = italic;
    }
    if (run.bold) {
      const bold = document.createElement('b');
      bold.appendChild(node);
      node = bold;
    }
    target.appendChild(node);
  }
}

export function clear(node: Node): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function field(
  labelText: string,
  input: HTMLElement,
  options: { id: string; type?: string } = { id: '' },
): HTMLElement {
  input.id = options.id;
  const labelNode = el('label', { for: options.id, text: labelText });
  return el('div', { class: 'field' }, [labelNode, input]);
}

export function fieldError(id: string, message: string): HTMLElement {
  return el('div', { class: 'field-error', id, text: message });
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusableWithin(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (node) => node.offsetParent !== null || node === document.activeElement,
  );
}

export interface PanelOptions {
  labelledBy?: string;
  role?: 'dialog' | 'alertdialog';
  className?: string;
  hostClassName?: string;
  initialFocus?: () => HTMLElement | null;
  onClose?: () => void;
  closeOnEscape?: boolean;
  closeOnScrim?: boolean;
}

export interface Panel {
  host: HTMLElement;
  dialog: HTMLElement;
  close(options?: { restoreFocus?: boolean }): void;
}

const openPanels: Panel[] = [];

export function topPanel(): Panel | null {
  return openPanels[openPanels.length - 1] ?? null;
}

/**
 * Opens a dialog, sheet or drawer: focus moves inside, Tab wraps, Escape closes
 * it, everything outside is inert, and focus returns to the opener.
 */
export function openPanel(content: HTMLElement, options: PanelOptions = {}): Panel {
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const dialog = el('div', {
    class: `dialog ${options.className ?? ''}`.trim(),
    role: options.role ?? 'dialog',
    'aria-modal': 'true',
    tabindex: -1,
  });
  if (options.labelledBy) dialog.setAttribute('aria-label', options.labelledBy);
  dialog.append(content);
  const host = el('div', { class: `scrim ${options.hostClassName ?? ''}`.trim() }, [dialog]);

  const root = document.getElementById('root');
  if (root) root.setAttribute('aria-hidden', 'true');
  if (root) root.classList.add('inert-outside');
  document.body.append(host);

  const panel: Panel = {
    host,
    dialog,
    close: (closeOptions) => {
      const index = openPanels.indexOf(panel);
      if (index === -1) return;
      openPanels.splice(index, 1);
      host.remove();
      if (openPanels.length === 0 && root) {
        root.removeAttribute('aria-hidden');
        root.classList.remove('inert-outside');
      }
      options.onClose?.();
      if (closeOptions?.restoreFocus === false) return;
      if (opener && opener.isConnected) opener.focus();
    },
  };
  openPanels.push(panel);

  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Tab') {
      const focusable = focusableWithin(dialog);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
      return;
    }
    if (event.key === 'Escape' && options.closeOnEscape !== false) {
      event.preventDefault();
      event.stopPropagation();
      panel.close();
    }
  });

  if (options.closeOnScrim !== false) {
    host.addEventListener('pointerdown', (event) => {
      if (event.target === host) panel.close();
    });
  }

  const target = options.initialFocus?.() ?? focusableWithin(dialog)[0] ?? dialog;
  target.focus();
  return panel;
}

export function announce(message: string): void {
  const region = document.querySelector<HTMLElement>('[data-announcements]');
  if (!region) return;
  region.textContent = '';
  window.setTimeout(() => {
    region.textContent = message;
  }, 20);
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function icon(path: string, label?: string): SVGElement {
  const node = svgEl('svg', {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 1.6,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': label ? null : 'true',
    role: label ? 'img' : null,
    'aria-label': label ?? null,
  });
  node.append(svgEl('path', { d: path }));
  return node;
}

export const ICONS = {
  home: 'M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z',
  files: 'M5 3h9l5 5v13H5zM14 3v5h5',
  share: 'M12 3v10M8 7l4-4 4 4M5 14v6h14v-6',
  shapes: 'M4 5h7v7H4zM14 13h6v6h-6zM13 4h8l-4 7z',
  inspector: 'M4 5h16M4 12h10M4 19h7',
  undo: 'M9 7 5 11l4 4M5 11h8a5 5 0 0 1 0 10h-2',
  redo: 'M15 7l4 4-4 4M19 11h-8a5 5 0 0 0 0 10h2',
  save: 'M5 5h11l3 3v11H5zM9 5v5h6V5M8 19v-5h8v5',
  zoomIn: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM16 16l5 5M11 8v6M8 11h6',
  zoomOut: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM16 16l5 5M8 11h6',
  importFile: 'M12 3v10m0 0 4-4m-4 4-4-4M5 17v3h14v-3',
  close: 'M6 6l12 12M18 6 6 18',
  server: 'M4 6h16v5H4zM4 13h16v5H4zM7 8.5h2M7 15.5h2',
  database: 'M12 4c4 0 7 1 7 2.5S16 9 12 9 5 7.9 5 6.5 8 4 12 4zM5 6.5v11C5 19 8 20 12 20s7-1 7-2.5v-11',
  firewall: 'M4 5h16v14H4zM4 10h16M4 15h16M9 5v5M15 10v5M9 15v4',
  router: 'M4 13h16v6H4zM12 13V8M8 8l4-4 4 4',
  balancer: 'M12 4v6M6 20v-6M18 20v-6M6 14h12M12 10v4',
  web: 'M4 6h16v12H4zM4 10h16M7 8h.01M9.5 8h.01',
  api: 'M8 4H5v16h3M16 4h3v16h-3M9 12h6',
  terminal: 'M6 3h12v18H6zM9 7h6M9 11h6M9 15h3',
  workstation: 'M4 5h16v9H4zM9 18h6M12 14v4',
  cloud: 'M7 18h10a4 4 0 0 0 0-8 6 6 0 0 0-11.6 1.6A3.2 3.2 0 0 0 7 18z',
  thirdParty: 'M9 8a3 3 0 1 0 0-4 3 3 0 0 0 0 4zM4 20c0-3 2.2-5 5-5s5 2 5 5M16 11h5M18.5 8.5v5',
  backup: 'M5 7h14v4H5zM5 13h14v4H5zM8 9h.01M8 15h.01M12 20v-2',
  zone: 'M4 5h16v14H4zM4 9h16',
} as const;
