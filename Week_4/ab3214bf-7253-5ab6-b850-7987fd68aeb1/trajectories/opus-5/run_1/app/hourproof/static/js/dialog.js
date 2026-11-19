// Every overlay: focus taken, Tab kept inside, Escape records nothing.

import { el, focusFirst, focusable } from './dom.js';
import { motionAttributes } from './motion.js';

const stack = [];

function overlays() {
  return document.getElementById('overlays');
}

export class Dialog {
  constructor({ name, variant = '', sheet = '', scrim = true }) {
    this.name = name;
    this.opener = document.activeElement;
    this.problemsRegion = el('div', {
      role: 'alert',
      'aria-live': 'assertive',
      'aria-label': 'Problems to fix',
      className: 'problems',
    });
    this.heading = el('h2', { text: name });
    this.bodyNode = el('div', { className: 'stack' });
    this.buttonsNode = el('div', { className: 'dialog__buttons' });
    this.node = el(
      'div',
      {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': name,
        className: `dialog ${variant} ${sheet}`.trim(),
        dataset: { dialog: name },
      },
      [this.heading, this.problemsRegion, this.bodyNode, this.buttonsNode]
    );
    motionAttributes(this.node, 200);
    this.scrim = scrim ? el('div', { className: 'scrim' }) : null;
    this.closed = false;
    this.onClose = null;
    if (this.scrim) overlays().append(this.scrim);
    overlays().append(this.node);
    stack.push(this);
    this.keyListener = (event) => this.handleKey(event);
    this.node.addEventListener('keydown', this.keyListener);
    window.requestAnimationFrame(() => focusFirst(this.node));
  }

  handleKey(event) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      if (stack[stack.length - 1] === this) this.close();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = focusable(this.node);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  setSheet(sheet) {
    this.node.classList.remove('dialog--sheet-bottom', 'dialog--sheet-right');
    if (sheet) this.node.classList.add(sheet);
  }

  close({ focusTarget = null } = {}) {
    if (this.closed) return;
    this.closed = true;
    const index = stack.indexOf(this);
    if (index >= 0) stack.splice(index, 1);
    this.node.remove();
    if (this.scrim) this.scrim.remove();
    const target = focusTarget || this.opener;
    if (target && document.contains(target)) target.focus();
    if (this.onClose) this.onClose();
  }
}

export function topDialog() {
  return stack[stack.length - 1] || null;
}

export function openDialogs() {
  return stack.slice();
}

export function closeAllDialogs() {
  stack.slice().reverse().forEach((dialog) => dialog.close());
}

export function field({ label, name, multiline = false, value = '' }) {
  const input = multiline
    ? el('textarea', { dataset: { field: name }, id: `field-${name}` })
    : el('input', { type: 'text', dataset: { field: name }, id: `field-${name}` });
  input.value = value;
  const wrap = el('div', { className: 'field' }, [
    el('label', { for: `field-${name}`, text: label }),
    input,
  ]);
  return { wrap, input };
}
