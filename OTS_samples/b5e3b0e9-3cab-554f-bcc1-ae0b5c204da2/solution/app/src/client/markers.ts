const timers = new WeakMap<Element, Map<string, number>>();

/**
 * Sets a motion marker and clears it by a browser timer, never by the end of a stylesheet animation, so advancing
 * the browser clock by `ms` clears it.
 */
export function mark(element: Element, attribute: "data-motion" | "data-outline", value: string, ms: number): void {
  const own = timers.get(element) ?? new Map<string, number>();
  timers.set(element, own);
  window.clearTimeout(own.get(attribute));
  element.setAttribute(attribute, value);
  own.set(
    attribute,
    window.setTimeout(() => {
      if (element.getAttribute(attribute) === value) element.removeAttribute(attribute);
    }, ms),
  );
}

export const EASE = "cubic-bezier(.2,.8,.2,1)";
export const MOVE_MS = 250;
export const ALERT_MS = 250;
export const PULSE_MS = 1200;
export const FLASH_MS = 600;
export const OUTLINE_MS = 2000;
