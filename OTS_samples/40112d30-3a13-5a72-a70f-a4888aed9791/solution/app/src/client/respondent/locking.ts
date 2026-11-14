// A response that was continued on another device leaves every control on the page disabled (brief: Moved and closed).

const NATIVE_CONTROLS = 'button, input, select, textarea';
const CUSTOM_CONTROLS = '[role="gridcell"], [role="listitem"]';

export function lockPage(host: HTMLElement): void {
  host.setAttribute('data-locked', '');
  for (const control of host.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(NATIVE_CONTROLS)) {
    control.disabled = true;
  }
  for (const part of host.querySelectorAll<HTMLElement>(CUSTOM_CONTROLS)) {
    part.setAttribute('aria-disabled', 'true');
    part.setAttribute('tabindex', '-1');
  }
}

export const isLocked = (element: Element): boolean => element.closest('[data-locked]') !== null;
