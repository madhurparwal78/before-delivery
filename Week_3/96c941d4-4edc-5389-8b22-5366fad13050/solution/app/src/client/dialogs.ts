import { h } from './dom.js';

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DialogHandle {
  element: HTMLElement;
  close(): void;
}

interface Layer {
  handle: DialogHandle;
  restore: () => void;
}

/** Layered modal dialogs: Tab is trapped in the topmost layer and Escape closes only that layer. */
class DialogStack {
  private readonly container: HTMLElement;
  private readonly layers: Layer[] = [];

  constructor() {
    this.container = h('div', { class: 'dialog-layer' });
    document.addEventListener('keydown', (event) => this.onKeyDown(event), true);
  }

  mount(parent: HTMLElement): void {
    parent.append(this.container);
  }

  open(
    name: string,
    build: (handle: DialogHandle) => Node[],
    options: { restoreFocus?: () => void; initialFocus?: () => HTMLElement | null } = {},
  ): DialogHandle {
    const opener = document.activeElement as HTMLElement | null;
    const element = h('div', {
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': name,
      class: 'dialog',
    });
    const handle: DialogHandle = {
      element,
      close: () => this.closeHandle(handle),
    };
    for (const node of build(handle)) element.append(node);
    this.container.append(element);
    this.container.classList.add('open');
    this.layers.push({ handle, restore: options.restoreFocus ?? (() => opener?.focus({ preventScroll: true })) });
    const initial = options.initialFocus?.() ?? (element.querySelector(FOCUSABLE) as HTMLElement | null);
    initial?.focus();
    return handle;
  }

  private closeHandle(handle: DialogHandle): void {
    const index = this.layers.findIndex((layer) => layer.handle === handle);
    if (index === -1) return;
    const [layer] = this.layers.splice(index, 1);
    layer.handle.element.remove();
    if (this.layers.length === 0) this.container.classList.remove('open');
    layer.restore();
  }

  depth(): number {
    return this.layers.length;
  }

  top(): HTMLElement | null {
    const layer = this.layers[this.layers.length - 1];
    return layer === undefined ? null : layer.handle.element;
  }

  private onKeyDown(event: KeyboardEvent): void {
    const top = this.top();
    if (top === null) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.layers[this.layers.length - 1].handle.close();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...top.querySelectorAll(FOCUSABLE)] as HTMLElement[];
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (!top.contains(active)) {
      event.preventDefault();
      first.focus();
      return;
    }
    if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
      return;
    }
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    }
  }
}

export const dialogs = new DialogStack();
