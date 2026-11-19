/**
 * Small DOM helpers shared by the screens: element creation with
 * attributes, focus trap management for dialogs, and the published
 * Web Animations API motion.
 */

import { EASING } from './colours.js';

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string | number | boolean | null> = {}, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    node.setAttribute(k, String(v));
  }
  if (text !== undefined) node.textContent = text;
  return node;
}

export function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** Run one of the published animations, or nothing under reduced motion. */
export function animate(el: Element, id: string, keyframes: Keyframe[], duration: number, delay = 0): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const animation = el.animate(keyframes, { id, duration, easing: EASING, fill: 'both', delay });
  animation.commitStyles?.();
}

export const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export interface DialogController {
  wrapper: HTMLDivElement;
  close(): void;
}

/** Open a dialog: focus trap, Escape close, focus restore, hidden when closed. */
export function openDialog(opts: {
  label: string;
  build(body: HTMLDivElement, close: () => void): void;
  opener?: HTMLElement | null;
  dismissible?: boolean;
  panelClass?: string;
}): DialogController {
  const opener = opts.opener ?? document.activeElement as HTMLElement | null;
  const wrapper = el('div', { class: 'dialog-scrim', role: 'presentation' });
  const panel = el('div', { class: `dialog ${opts.panelClass ?? ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.label });
  const body = el('div', { class: 'dialog-body' });
  panel.appendChild(body);
  wrapper.appendChild(panel);
  wrapper.style.display = 'none';

  const close = () => {
    wrapper.style.display = 'none';
    wrapper.remove();
    (wrapper as HTMLElement & { inert?: boolean }).inert = true;
    if (opener && document.contains(opener)) opener.focus();
  };
  opts.build(body, close);
  wrapper.style.display = '';
  document.body.appendChild(wrapper);
  const focusables = () => Array.from(panel.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter((n) => !n.hasAttribute('disabled') && n.offsetParent !== null);
  const first = focusables()[0];
  (first ?? panel).focus();
  panel.setAttribute('tabindex', '-1');
  const onKeydown = (e: KeyboardEvent) => {
    if (!document.contains(wrapper)) {
      document.removeEventListener('keydown', onKeydown);
      return;
    }
    if (e.key === 'Escape' && (opts.dismissible ?? true)) {
      e.preventDefault();
      e.stopPropagation();
      close();
      document.removeEventListener('keydown', onKeydown);
      return;
    }
    if (e.key === 'Tab') {
      const items = focusables();
      if (items.length === 0) return;
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstItem) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && document.activeElement === lastItem) {
        e.preventDefault();
        firstItem.focus();
      }
    }
  };
  document.addEventListener('keydown', onKeydown);
  wrapper.addEventListener('mousedown', (e) => {
    if (e.target === wrapper && (opts.dismissible ?? true)) close();
  });
  return { wrapper, close };
}
