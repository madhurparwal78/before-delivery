// A pending control is aria-disabled, keeps focus and sends nothing further.

import { on } from '../dom.js';

function isPending(control: Element): boolean {
  return control.getAttribute('aria-disabled') === 'true';
}

export function pressable(control: HTMLElement, run: () => Promise<void> | void): void {
  on(control, 'click', (event) => {
    if (isPending(control)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    control.setAttribute('aria-disabled', 'true');
    void Promise.resolve(run()).finally(() => {
      if (control.isConnected) control.removeAttribute('aria-disabled');
    });
  });
}
