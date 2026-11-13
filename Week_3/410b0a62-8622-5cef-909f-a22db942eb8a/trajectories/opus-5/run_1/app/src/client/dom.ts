export type Child = Node | string | null | undefined;

export interface Options {
  class?: string;
  text?: string;
  attrs?: Record<string, string | number | boolean | null | undefined>;
  on?: Record<string, (event: Event) => void>;
  children?: Child[];
}

function applyOptions(node: Element, options: Options): void {
  if (options.class) node.setAttribute('class', options.class);
  if (options.text !== undefined) node.textContent = options.text;
  for (const [name, value] of Object.entries(options.attrs ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    node.setAttribute(name, String(value));
  }
  for (const [name, handler] of Object.entries(options.on ?? {})) {
    node.addEventListener(name, handler);
  }
  for (const child of options.children ?? []) {
    if (child === null || child === undefined) continue;
    node.append(child);
  }
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: Options = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  applyOptions(node, options);
  return node;
}

export function svgEl(tag: string, options: Options = {}): SVGElement {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  applyOptions(node, options);
  return node;
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Keeps Tab and Shift+Tab inside a dialog, closes on Escape, returns focus. */
export interface DialogHandle {
  element: HTMLElement;
  close(): void;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusableIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (node) => node.offsetParent !== null || node === document.activeElement,
  );
}

export function openDialog(args: {
  label: string;
  className?: string;
  opener: HTMLElement | null;
  content: (handle: DialogHandle) => Child[];
}): DialogHandle {
  const backdrop = el('div', { class: 'dialog-backdrop' });
  const dialog = el('div', {
    class: `dialog ${args.className ?? ''}`.trim(),
    attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': args.label },
  });
  const openerText = args.opener?.textContent ?? '';
  const handle: DialogHandle = {
    element: dialog,
    close() {
      backdrop.remove();
      const opener =
        args.opener && document.body.contains(args.opener)
          ? args.opener
          : [...document.querySelectorAll<HTMLElement>('button, a')].find(
              (node) => node.textContent === openerText,
            );
      opener?.focus();
    },
  };
  dialog.append(...(args.content(handle).filter(Boolean) as Node[]));
  backdrop.append(dialog);
  document.body.append(backdrop);

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!document.body.contains(dialog)) {
      document.removeEventListener('keydown', onKeyDown, true);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      handle.close();
      document.removeEventListener('keydown', onKeyDown, true);
      return;
    }
    if (event.key !== 'Tab') return;
    const items = focusableIn(dialog);
    if (items.length === 0) return;
    const first = items[0] as HTMLElement;
    const last = items[items.length - 1] as HTMLElement;
    const active = document.activeElement as HTMLElement | null;
    if (!active || !dialog.contains(active)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
      return;
    }
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };
  document.addEventListener('keydown', onKeyDown, true);
  const target = focusableIn(dialog)[0];
  if (target) target.focus();
  return handle;
}

export function fieldError(input: HTMLElement, message: string): HTMLElement {
  const id = `${input.id || `field-${Math.random().toString(36).slice(2)}`}-error`;
  input.id = input.id || id.replace('-error', '');
  input.setAttribute('aria-describedby', id);
  input.setAttribute('aria-invalid', 'true');
  return el('p', { class: 'field-error', text: message, attrs: { id } });
}

/** Pointer and touch dragging onto a day chip, used by calendar items and the library. */
export function onDragToDay(node: HTMLElement, onDrop: (date: string) => void): void {
  const DRAG_THRESHOLD_PX = 6;
  node.addEventListener('dragstart', (event) => event.preventDefault());
  node.addEventListener('pointerdown', (event) => {
    const pointer = event as PointerEvent;
    if (pointer.button !== 0) return;
    const startX = pointer.clientX;
    const startY = pointer.clientY;
    let dragging = false;
    let hovered: HTMLElement | null = null;
    const chipAt = (x: number, y: number): HTMLElement | null =>
      (document.elementFromPoint(x, y)?.closest('.day-chip') as HTMLElement | null) ?? null;
    const move = (moveEvent: Event): void => {
      const point = moveEvent as PointerEvent;
      if (!dragging) {
        if (Math.hypot(point.clientX - startX, point.clientY - startY) < DRAG_THRESHOLD_PX) return;
        dragging = true;
        node.classList.add('dragging');
      }
      moveEvent.preventDefault();
      const under = chipAt(point.clientX, point.clientY);
      if (hovered && hovered !== under) hovered.classList.remove('drop-target');
      hovered = under;
      if (hovered) hovered.classList.add('drop-target');
    };
    const up = (upEvent: Event): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (hovered) hovered.classList.remove('drop-target');
      if (!dragging) return;
      node.classList.remove('dragging');
      window.addEventListener(
        'click',
        (click) => {
          click.preventDefault();
          click.stopPropagation();
        },
        { capture: true, once: true },
      );
      const point = upEvent as PointerEvent;
      const date = chipAt(point.clientX, point.clientY)?.getAttribute('data-date');
      if (date) onDrop(date);
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
  });
}

/** A pill disabled while pending loses focus; this puts it back when it returns. */
export function keepFocus(control: HTMLElement): void {
  if (document.activeElement === document.body || document.activeElement === null) control.focus();
}
