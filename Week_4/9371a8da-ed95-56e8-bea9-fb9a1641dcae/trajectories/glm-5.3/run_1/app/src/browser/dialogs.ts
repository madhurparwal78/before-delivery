import { el } from './dom.js';
import { pushLayer, popLayer } from './app-state.js';
import { MentionState, mentionState, updateMention, applyMention } from './dom.js';

export interface DialogOpts {
  title: string;
  wide?: boolean;
  close: () => void;
  labelledBy?: string;
  alert?: boolean;
}

/** Base dialog: holds focus, wraps Tab, Escape closes only itself. */
export function dialogFrame(opts: DialogOpts, build: (body: HTMLDivElement, dlg: HTMLDivElement) => void): HTMLDivElement {
  const id = `dlg-${Math.random().toString(36).slice(2, 8)}`;
  const heading = el('h2', { id }, opts.title);
  const head = el('div', { class: 'dialog-head', style: 'display:flex;align-items:center;gap:0.6rem' }, heading);
  const body = el('div');
  const dlg = el('div', {
    class: `dialog${opts.wide ? ' dialog-full' : ''}${opts.alert ? ' alert-dialog' : ''} dialog-anim-in`,
    role: opts.alert ? 'alertdialog' : 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': id,
    onkeydown: (ev: Event) => {
      const kev = ev as KeyboardEvent;
      if (kev.key === 'Escape') {
        kev.stopPropagation();
        opts.close();
      } else if (kev.key === 'Tab') {
        wrapTab(dlg, kev);
      }
    },
  }, head, body);
  build(body, dlg);
  pushLayer(id, opts.close);
  // Each dialog opens with focus on its first control; a dialog with none focuses itself.
  if (document.activeElement === document.body || !dlg.contains(document.activeElement)) {
    queueMicrotask(() => {
      const focusables = Array.from(
        dlg.querySelectorAll<HTMLElement>('input, select, textarea, button, [href]'),
      ).filter((n) => !n.hasAttribute('disabled') && n.getAttribute('aria-disabled') !== 'true' && n.offsetParent !== null);
      if (focusables.length > 0) focusables[0].focus();
      else {
        dlg.setAttribute('tabindex', '-1');
        dlg.focus();
      }
    });
  }
  return el('div', {
    class: 'dialog-backdrop',
    onmousedown: (ev: Event) => {
      if ((ev.target as HTMLElement).classList.contains('dialog-backdrop')) opts.close();
    },
  }, dlg);
}

export function wrapTab(container: HTMLElement, ev: KeyboardEvent): void {
  const focusables = Array.from(
    container.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'),
  ).filter((n) => !n.hasAttribute('disabled') && n.getAttribute('aria-disabled') !== 'true');
  if (focusables.length === 0) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const active = document.activeElement as HTMLElement | null;
  if (ev.shiftKey) {
    if (active === first || !container.contains(active)) {
      ev.preventDefault();
      last.focus();
    }
  } else if (active === last) {
    ev.preventDefault();
    first.focus();
  }
}

export function releaseDialog(id: string): void {
  popLayer(id);
}

export function fieldError(message?: string): HTMLElement | null {
  if (!message) return null;
  return el('p', { class: 'field-error', role: 'alert' }, message);
}

export function labelledTextbox(
  label: string,
  value: string,
  oninput: (v: string) => void,
  extra: Record<string, unknown> = {},
): { row: HTMLElement; textarea: HTMLTextAreaElement } {
  const id = `tb-${Math.random().toString(36).slice(2, 8)}`;
  const textarea = el('textarea', {
    id, value, oninput: (e: Event) => oninput((e.target as HTMLTextAreaElement).value),
    ...extra,
  }) as HTMLTextAreaElement;
  const row = el('div', { class: 'field' }, el('label', { for: id }, label), textarea);
  return { row, textarea };
}

export function buildMentionList(
  state: MentionState,
  textarea: HTMLTextAreaElement,
): HTMLElement | null {
  if (!state.open || state.options.length === 0) return null;
  const list = el('div', {
    class: 'mention-list',
    role: 'listbox',
    'aria-label': 'Mention people',
    id: `mention-${Math.random().toString(36).slice(2, 8)}`,
  });
  const id = list.getAttribute('id') as string;
  state.options.forEach((opt, idx) => {
    const item = el('div', {
      role: 'option',
      class: idx === state.highlighted ? 'highlighted' : '',
      'aria-selected': idx === state.highlighted ? 'true' : 'false',
      id: `${id}-opt-${idx}`,
      onmousedown: (ev: Event) => {
        ev.preventDefault();
        state.highlighted = idx;
        applyMention(state, textarea);
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      },
    }, `@${opt.handle}`);
    list.appendChild(item);
  });
  return list;
}

export function mentionKeydown(
  ev: KeyboardEvent,
  state: MentionState,
  textarea: HTMLTextAreaElement,
  onCommit: () => void,
): boolean {
  if (!state.open || state.options.length === 0) return false;
  if (ev.key === 'ArrowDown') {
    state.highlighted = (state.highlighted + 1) % state.options.length;
    ev.preventDefault();
    return true;
  }
  if (ev.key === 'ArrowUp') {
    state.highlighted = state.highlighted === 0 ? state.options.length - 1 : state.highlighted - 1;
    ev.preventDefault();
    return true;
  }
  if (ev.key === 'Enter' || ev.key === 'Tab') {
    ev.preventDefault();
    if (applyMention(state, textarea)) return true;
    return false;
  }
  if (ev.key === 'Escape') {
    state.open = false;
    ev.stopPropagation();
    return true;
  }
  void onCommit;
  return false;
}

export { mentionState, updateMention };
