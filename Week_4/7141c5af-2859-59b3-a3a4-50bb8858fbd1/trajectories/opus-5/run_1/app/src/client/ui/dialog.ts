/**
 * Dialogs and sheets. Each keeps Tab inside it, closes on Escape, returns focus
 * to its opener at once, grows from its centre from 768 px and rises as a sheet
 * at 375, and carries on from where it is when reopened mid-animation.
 */
import { DURATION, animate, reducedMotion, stopAnimations } from './motion.ts';
import { all, el, need } from './dom.ts';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DialogHandle {
  readonly root: HTMLElement;
  readonly body: HTMLElement;
  readonly problems: HTMLElement;
  close(): void;
  isOpen(): boolean;
}

let openDialog: DialogHandle | null = null;

export function currentDialog(): DialogHandle | null {
  return openDialog;
}

function focusables(root: HTMLElement): HTMLElement[] {
  return all<HTMLElement>(FOCUSABLE, root).filter(
    (node) => node.offsetParent !== null || node === document.activeElement,
  );
}

/** A sheet at 375, a side sheet from 768, a centred dialog at 1280. */
function isPhone(): boolean {
  return window.matchMedia('(max-width: 599px)').matches;
}

function openFrames(rtl: boolean): Keyframe[] {
  if (isPhone()) {
    return [{ transform: 'translateY(100%)' }, { transform: 'translateY(0)' }];
  }
  if (window.matchMedia('(min-width: 600px) and (max-width: 1023px)').matches) {
    const from = rtl ? 'translateX(-100%)' : 'translateX(100%)';
    return [{ transform: from }, { transform: 'translateX(0)' }];
  }
  return [
    { transform: 'scale(0.86)', opacity: 0 },
    { transform: 'scale(1)', opacity: 1 },
  ];
}

export interface DialogOptions {
  /** The accessible name, which is also its visible heading. */
  name: string;
  /** The control that opened it; focus returns here. */
  opener: HTMLElement;
  /** `Problems` in the page's language. */
  problemsName?: string;
  /** Built once the dialog is on the page. */
  build: (body: HTMLElement, handle: DialogHandle) => void;
  /** Called after the dialog has closed and focus has moved back. */
  onClose?: () => void;
}

/**
 * Opens a dialog. Opening always moves focus inside it to its first field,
 * otherwise its first control.
 */
export function openModal(options: DialogOptions): DialogHandle {
  openDialog?.close();

  const problemsName = options.problemsName ?? 'Problems';
  const problems = el('div', { role: 'region', 'aria-label': problemsName, class: 'problems', hidden: true }, [
    el('h2', { text: problemsName }),
    el('ul', {}),
  ]);
  const body = el('div', { class: 'dialog-body' });
  const heading = el('h2', { class: 'dialog-heading', id: 'dialog-heading', text: options.name });
  const panel = el('div', { class: 'dialog-panel' }, [heading, problems, body]);
  const root = el(
    'div',
    {
      class: 'dialog-scrim',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': options.name,
    },
    [panel],
  );

  let open = true;
  let closing = false;

  const handle: DialogHandle = {
    root,
    body,
    problems,
    isOpen: () => open,
    close(): void {
      if (!open || closing) return;
      closing = true;
      open = false;
      // The page behind is usable at once while the closing animation runs.
      root.setAttribute('aria-hidden', 'true');
      root.style.pointerEvents = 'none';
      for (const node of focusables(root)) node.setAttribute('tabindex', '-1');
      if (openDialog === handle) openDialog = null;
      if (document.body.contains(options.opener)) options.opener.focus();
      else need<HTMLElement>('#page-heading').focus();

      const finish = (): void => {
        root.remove();
        options.onClose?.();
      };
      if (reducedMotion()) {
        finish();
        return;
      }
      stopAnimations(panel);
      const frames = openFrames(document.documentElement.dir === 'rtl');
      const closingAnimation = panel.animate([...frames].reverse(), {
        duration: DURATION.normal,
        easing: 'cubic-bezier(0.2, 0, 0.1, 1)',
      });
      closingAnimation.finished.then(finish).catch(finish);
    },
  };

  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      // Escape closes only the innermost open thing.
      const inner = root.querySelector('[data-open-list="true"]');
      if (inner) {
        inner.removeAttribute('data-open-list');
        event.stopPropagation();
        return;
      }
      event.stopPropagation();
      event.preventDefault();
      handle.close();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = focusables(root);
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  options.build(body, handle);
  document.body.append(root);
  openDialog = handle;

  // Focus the first field, otherwise the first control, on every opening.
  const field = root.querySelector<HTMLElement>('input, select, textarea');
  (field ?? focusables(root)[0])?.focus();

  animate(panel, openFrames(document.documentElement.dir === 'rtl'), DURATION.normal);
  return handle;
}

/** A non-modal popover: no Tab trap, and Tab past its edges closes it. */
export interface PopoverOptions {
  name: string;
  opener: HTMLElement;
  anchor: HTMLElement;
  build: (body: HTMLElement, close: () => void) => void;
  onClose?: () => void;
}

export function openPopover(options: PopoverOptions): { close: () => void } {
  const body = el('div', { class: 'popover-body' });
  const root = el(
    'div',
    { class: 'popover', role: 'dialog', 'aria-label': options.name },
    [body],
  );
  let open = true;

  const close = (): void => {
    if (!open) return;
    open = false;
    for (const node of focusables(root)) node.setAttribute('tabindex', '-1');
    root.remove();
    if (document.body.contains(options.opener)) options.opener.focus();
    options.onClose?.();
  };

  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = focusables(root);
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) close();
    else if (!event.shiftKey && document.activeElement === last) close();
  });

  options.build(body, close);
  document.body.append(root);
  placeInView(root, options.anchor);
  focusables(root)[0]?.focus();
  animate(root, [{ opacity: 0 }, { opacity: 1 }], DURATION.quick);
  return { close };
}

/** Keeps a popover or menu fully on screen, even at a drawing's edge. */
export function placeInView(node: HTMLElement, anchor: HTMLElement): void {
  const box = anchor.getBoundingClientRect();
  node.style.position = 'fixed';
  node.style.visibility = 'hidden';
  node.style.left = '0px';
  node.style.top = '0px';
  const own = node.getBoundingClientRect();
  const margin = 8;
  let left = box.left + box.width / 2 - own.width / 2;
  let top = box.bottom + margin;
  if (top + own.height > window.innerHeight - margin) {
    top = Math.max(margin, box.top - own.height - margin);
  }
  left = Math.min(Math.max(margin, left), Math.max(margin, window.innerWidth - own.width - margin));
  top = Math.min(Math.max(margin, top), Math.max(margin, window.innerHeight - own.height - margin));
  node.style.left = `${Math.round(left)}px`;
  node.style.top = `${Math.round(top)}px`;
  node.style.visibility = '';
}

/** A field row for a dialog, with its label tied to its control. */
export function field(
  id: string,
  label: string,
  control: HTMLElement,
): HTMLElement {
  control.id = id;
  return el('p', { class: 'field' }, [el('label', { for: id, text: label }), control]);
}

export function textField(id: string, label: string, value = '', attributes: Record<string, string> = {}): HTMLElement {
  const input = el('input', { type: 'text', value, ...attributes });
  return field(id, label, input);
}

export function selectField(
  id: string,
  label: string,
  options: readonly { value: string; label: string }[],
  value: string | null,
): HTMLElement {
  const select = el('select', {});
  for (const option of options) {
    select.append(el('option', { value: option.value, text: option.label, selected: option.value === value }));
  }
  return field(id, label, select);
}
